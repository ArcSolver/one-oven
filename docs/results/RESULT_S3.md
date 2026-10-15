# One Oven 3단계 구현 결과

작성: 2026-10-15 KST. 저장소: `one-oven`, `main`.
기준: `../DESIGN.md` 전체와 `../RESULT_S2.md`. 사용자 요청의 “3단계”는 실제 문서의 **5절·부록 A-3**이다.

**UI 없이 음성 파이프라인을 구현하고 두 자동 완료 기준을 통과했다.**
실제 로컬 Whisper·시스템 TTS를 사용했으며 실모델 음성 왕복도 끝까지 통과했다.
음성 지연은 크게 줄었지만 STT·모델의 개별 p95 목표와 실제 스피커 지연 검증은 남아 있다.

## 1. 만든 것

- `packages/voice` workspace와 `SttEngine`, `TtsEngine`, `AudioClip` 계약.
  내부 음성 형식은 mono 16 kHz PCM16 WAV이며 파일 형식을 검사한다.
- **Whisper 로컬 STT**: whisper.cpp CLI와 상주 HTTP 서버 두 경로. 서버는 루프백만 허용한다.
  기본 모델은 base.en, 힌트는 모든 발화에 공통인 요리·주방 단어 목록이다.
  실패 시 정답 `.txt`로 대체하지 않는다. `fixture`는 명시적 테스트 대역이다.
- **시스템 TTS**: Linux espeak-ng, macOS say → ffmpeg PCM 정규화.
  Linux 기본 음성은 실험 결과에 따라 en-gb, macOS 기본은 Samantha다.
  `silent`는 명시적인 테스트 대역이다.
- **Polly·Transcribe**: 실제 AWS SDK 명령을 사용하는 교체용 어댑터와 주입 클라이언트 모킹 테스트.
  객체 생성은 호출·자격 증명 조회를 하지 않는다. S3 CLI에는 실제 AWS 호출을 켜는 환경변수가 없다.
  S6에서 별도 승인 뒤 `allowAws: true`로 구성할 수 있다.
  Transcribe는 인라인 힌트 대신 사전 준비한 vocabulary name을 받는다.
- `npm run voice`: Enter로 녹음 시작/종료, `Alexa,` 접두어 제거,
  STT → **직접 ConversationSession** → TTS → SoX 재생. 사용자 WAV·trace를 `runs/`에 저장한다.
  녹음은 최대 60초이며 종료 시 프로세스와 임시 파일을 정리한다.
- `AlexaTimerEmulator`: 세션과 같은 HostTimers 저장소, 교체·취소·중복 방지·한 번만 발화,
  SimClock 변경 구독과 실제 시계 polling. 자작 차임 WAV와
  `Your <label> timer is done.`을 출력한다. 알림은 서버를 호출하거나 단계를 완료하지 않는다.
  응답·타이머 출력은 한 큐에 직렬화되고 음성 출력 실패도 trace에 남는다.
- 시스템 TTS 사용자 발화 WAV **12개**, `.txt` 정답, 의도 단어 manifest.
  주방·계획·next·지연·교체·완료·타이머 설정/취소를 포함한다.
  차임의 합성 소스와 무료 로컬 도구 설치 스크립트도 포함했다.
- `voice:roundtrip`, `voice:demo`, `voice:check`, `voice:latency`, `voice:fixtures`, `voice:setup` 명령.
  기존 서버 툴은 **6개 그대로**이며 UI·배포 코드는 추가하지 않았다.

설정·설치·실행 계약: [voice README](../../packages/voice/README.md).

## 2. 지연을 줄인 방법과 측정 조건

최적화 경로도 **Strands Agent → McpClient → 실제 Streamable HTTP 서버**를 거친다.
발화를 정규식으로 처리해 실모델을 건너뛰거나 서버 상태를 직접 수정하지 않았다.

1. `AfterToolsEvent.endTurn` 공개 훅으로 정상/오류 툴의 검증된 `say`를 바로 최종 응답으로 쓴다.
   모델이 같은 결과를 다시 문장으로 만드는 왕복을 없앴다. `replySource=tool-say`로 구분한다.
2. 음성 모드에서 `timer_suggestions`를 호스트가 자동 적용한다. 타이머를 설정하려고 모델을 추가 호출하지 않는다.
3. `list_dishes`는 준비 단계에서 한 번 읽고 캐시한다. ID·버전·미완료 단계와 최근 일반 대화 4개만 전달한다.
   전체 계획을 대화 이력과 시스템 문맥에 계속 중복 전달하지 않는다.
4. 짧은 공통 음성 프롬프트를 사용한다. 일반 S2 텍스트 경로는 기본 동작을 유지하며
   `AGENT_VOICE_MODE=1`로 같은 최적화를 켤 수 있다.
5. 공급자 스트리밍을 유지하고 첫 content delta 시점을 `firstDeltaMs`로 기록한다.
   검증된 최종 발화가 준비되는 즉시 TTS를 시작해 턴 후처리와 겹친다.
   검증 전 토큰을 읽거나 도구 실행 성공 전에 성공을 말하지 않는다.

실모델은 지정된 **`http://127.0.0.1:10100/v1`**에서 `/models`로 확인한
`local-openai-compatible`를 환경변수로 선택했다. 코드 기본값에 모델 ID를 넣지 않았다.
S2와 같은 fast 모델을 사용했으므로 모델 교체 효과로 개선치를 부풀리지 않았다.
빠른 모델 경로는 기존 `AGENT_MODEL` 설정으로 교체 가능하다.

조건: temperature 0, maxTokens 2048, 같은 weekday 20턴, Dot, America/Chicago,
매 회 새 SQLite·세션·HTTP 서버, 지연 5분·중복 지연 포함, 모델 호출 순차 실행.
기준 경로 1회와 최적화 경로 5회를 실행했다. 최적화 5회는 모두 성공했고 실패/타임아웃을 제외한 표본이 없다.
실행 환경은 Node 24.21.0, Linux x86_64, 할당 CPU 8개,
whisper.cpp v1.8.2, CPU 4 threads, base.en, beam/best-of 1, espeak-ng 1.52.0/en-gb/155 wpm이다.
정확한 CPU·버전·모델 및 WAV SHA-256은 [ENVIRONMENT.json](s3/ENVIRONMENT.json)에 있다.

### 에이전트 지연 비교

| 경로 | 성공 | 반환 턴 | 모델 요청 | 턴 p50 | 턴 p95 | 최대 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S2 방식 재측정 | 1/1 | 20 | 54 | 6.522s | 8.884s | 9.319s |
| S3 음성 최적화 | **5/5** | 100 | **100** | **2.461s** | **3.183s** | 3.678s |

p50은 **62.3%**, p95는 **64.2%** 줄었다. 첫 A/B 쌍만 비교하면 6.522→2.455s,
8.884→3.103s다. 모델 요청은 한 흐름당 54→20회이며 MCP 호출은 두 경로 모두 21회다.
MCP 21회는 카탈로그 1회와 변경·진행 20회이고, 호스트 타이머는 MCP 툴이 아니다.
입력 토큰은 기준 1,559,913/회에서 최적화 평균 44,636/회로 **97.1% 감소**했다.
이는 공급자가 보고한 처리량이지 고유 텍스트량·청구 금액이 아니다.

최적화의 첫 delta p50/p95는 2.412/3.141s, 모델 전체 시간은 2.454/3.169s다.
이 엔드포인트에서는 첫 delta가 도착한 뒤 완료까지의 차이가 작았다.
따라서 **스트리밍만으로 6~9초를 해결했다고 주장하지 않는다**. 개선의 주된 근거는
모델 왕복 수와 입력량 감소다. 원문/최종 발화 린트 위반·fallback은 두 경로 모두 0이다.
서버 `say`를 사용한 턴은 모델 자유 생성 문장의 품질 평가와 구분한다.

근거: [A/B 원본 표](s3/LATENCY_AB.json), [추가 4회](s3/LATENCY_VOICE_4.json),
[100턴 집계와 요청별 수치](s3/METRICS.json).
전체 원본 trace는 `runs/s3-latency-ab/`, `runs/s3-latency-voice/`에 있다.

### 실제 음성 왕복

Whisper base.en + **실모델** + 시스템 TTS로 20턴 전체를 실제 실행한 결과다.
사용자 녹음 길이는 제외하고 완성된 입력 WAV를 공급한 순간부터 잰다.

| 구간 | p50 | p95 | 최대 | 설계 목표와 판정 |
| --- | ---: | ---: | ---: | --- |
| STT | 1.255s | 1.408s | 1.614s | 1.0s: 미달 |
| 모델 | 2.447s | 3.147s | 4.835s | 2.5s: p50 충족, p95 미달 |
| MCP 툴 | 7.62ms | 13.89ms | 21.21ms | 50ms: 충족 |
| TTS 합성 | 88.18ms | 107.69ms | 112.01ms | 600ms: **오디오 준비 기준** 충족 |
| 입력 WAV→출력 오디오 준비 | **3.911s** | **4.507s** | **6.139s** | 합산 목표 4.15s: p95 미달 |

스피커가 없는 컨테이너라 이 표의 첫 출력은 **`file-ready`**이며 물리적 첫 소리가 아니다.
인터랙티브 실행은 `device-launch`를 기록하지만 실제 스피커 지연은 오디오 루프백 측정이 필요하다.
각 구간의 분위수를 더한 값과 전체 분위수는 같지 않다.
합성 사용자 음성을 사용했으므로 사람 억양·부엌 소음의 수치로 일반화하지 않는다.

실모델 음성 데모는 **171.75s**에 20턴·12단계·12개 타이머를 완료했다.
scripted 음성 데모는 같은 실제 Whisper/TTS로 **120.61s**, 전체 오디오 준비 p50/p95 **1.400/1.544s**였다.
후자는 실모델 성능으로 계산하지 않았다.
[실모델 보고서](s3/VOICE_DEMO_LIVE.json), [scripted 보고서](s3/VOICE_DEMO_SCRIPTED.json),
[음성 trace 샘플](s3/TRACE_SAMPLE.jsonl), [타이머 12회](s3/TIMER_TRACE.jsonl).

## 3. 테스트와 완료 기준

| 항목 | 결과 |
| --- | --- |
| 최종 새 로컬 체크아웃 `npm ci && npm run check` | 통과, 기준 `e6dc151` |
| 자동 단위·통합 테스트 | **55개 통과**, 실패/생략 0: 서버 34 + 에이전트 12 + 음성 9 |
| 기존 엔진 회귀 | 1,000회 속성 검사, 4개 골든, 레시피 검증, 실제 HTTP smoke 유지 |
| 기존 scripted 텍스트 E2E | 20턴·12단계·최종 버전 18·6:35 PM·경고 0 |
| 실제 Whisper WAV 왕복 | **12/12 통과**; HTTP base.en과 CLI base.en 양쪽 검증 |
| 60배속 무인 음성 데모 | **통과**, real STT + real TTS + scripted Agent, 20턴·12단계 |
| 타이머 계획 시각 ±1분 | **12/12 통과**, 최대 오차 **0ms**(모의 시계), 중복 알림 없음 |
| 실모델 최적화 상태 회귀 | **5/5 성공**, 100턴, 모델 요청 100회, 린트 위반 0 |
| 실모델 전체 음성 흐름 | **1/1 성공**, 20턴·12단계·타이머 12회·6:35 PM |
| 타이머가 먼저 서버 진행하지 않음 | 콜백·출력 큐 검사에서 세션 호출 0회 |
| Polly·Transcribe | 모킹 통과, 실제 AWS 호출 **0회** |
| 수동 사람 발화·실제 조리·스피커 녹음 | **미실행**; 사용자 진행용 기록 틀 작성 |

새 체크아웃 로그: [CHECK_S3_CLEAN.log](CHECK_S3_CLEAN.log).
STT 결과: [상주 서버](s3/ROUNDTRIP_BASE.json), [CLI](s3/ROUNDTRIP_CLI.json).
새 음성 테스트는 만료/교체/취소/정리, 오디오 계약, AWS mock,
알림 큐 직렬화·출력 실패, 중복 입력 차단, 빈 STT, 힌트 전송·잘못된 STT 응답 거절을 포함한다.
에이전트 회귀는 오류 `say`를 한 번만 전달하고 카탈로그 갱신 뒤에도 진행 중 계획을 유지하는지 검사한다.

## 4. 실패 실험과 채택하지 않은 경로

- 최초 **en-us + base.en 6/12**: burners→burgers, green beans→marine beans 등.
  시스템 음성을 en-gb로 바꾸고 공통 조리 단어 힌트를 보강했다.
  발화별 정답을 STT 힌트에 넣지 않았다. `6.30pm`의 숫자·접미사 분리는 검사 정규화를 고쳤다.
- **tiny.en 11/12**(당시 단어 포함 검사): STT p50/p95 **0.702/0.795s**로 빨랐지만
  “Cancel the salmon timer”를 놓쳤다. 주방 문장의 숫자와 명사 연결도 부정확했다.
  최종 검사는 `1 oven`, `4 burners`, `1 cook`처럼 함께 검사하도록 강화했다. 기본 모델로 채택하지 않았다.
- **base.en audio context 768 실험 11/12**: 약 0.5~0.65s로 빨라졌으나 green beans를 놓쳤다.
  최종 경로는 전체 context(0)를 명시하고 이 실험 설정은 제품 옵션에서 제거했다.
- 최초 무인 데모는 긴 단계 원문을 읽은 뒤 STT가 “rice”를 변형해 scripted의 엄격한 매칭이 실패했다.
  “The rice step is finished. What is next?”처럼 짧고 요리 이름이 명확한 사용자 WAV로 바꾸었다.
  scripted는 실제 running 단계 중 이름이 일치하는 하나만 선택하며 모호하면 재질문한다.
  실모델도 동일한 짧은 발화로 검증했다. 서버 상태를 테스트 기대값으로 직접 바꾸지 않았다.

[초기 STT 실패](s3/ROUNDTRIP_EN_US_FAILURE.json), [tiny 실험](s3/ROUNDTRIP_TINY_EXPERIMENT.json),
[짧은 context 실험](s3/ROUNDTRIP_SHORT_CONTEXT_EXPERIMENT.json), [초기 데모 실패](s3/INITIAL_DEMO_FAILURE.log).
이는 원인 확인 없는 외부 서비스 장애 주장이나 통과율에서 숨긴 실패가 아니다.
실험 결과를 보존하고 최종 선택·검증 결과와 분리했다.

## 5. 설계와 달라진 점 / 구체화

- 개발 모델은 지정된 로컬 OpenAI 호환 endpoint만 실호출했다. Bedrock·AWS는 호출하지 않았다.
- loop는 A-3에서 허용한 **직접 ConversationSession** 경로를 사용한다. gateway 음성 업로드/SSE audio는 S7에 남겼다.
- 음성 모드의 타이머 handoff와 툴 `say` 최종 응답을 호스트가 맡는다.
  일반 텍스트 경로는 모델이 타이머를 고르는 기존 동작을 유지한다.
- `TurnResult.replySource`, 모델 `firstDeltaMs`, `turn(utterance, onSpeech?)`, `prepare()`를 추가했다.
  Clock의 선택적 `onChange()`와 HostTimers의 `onFire/start/stop/poll`을 추가했다.
- Whisper는 CLI 외 상주 서버도 지원한다. 실제 성능·정확도를 비교한 뒤 base.en을 유지했다.
- `--speed 60`은 **조리 대기 시간**을 60배로 흘리고 STT·모델·TTS 처리 중에는 모의 시계를 멈춘다.
  90분을 연속 실시간으로 흘리며 음성 재생까지 60배속으로 만드는 방식은 아니다.
  보고서에 `clockPolicy`와 `instant:false`를 남겼다.
- 커밋한 WAV 12개 중 주방·계획·next·지연을 데모에서 재사용한다.
  각 완료 발화는 실제 계획의 요리/오븐 이름으로 추가 WAV를 생성해 입력한다.
  완료 단계 판정과 변경은 여전히 모델→HTTP MCP를 통해 수행한다.
- 수동 녹음·실제 조리는 자동화 환경에서 대신 실행했다고 주장하지 않는다.
  [사람 발화 기록 틀](../calibration/VOICE_MANUAL_S3.md)을 제공했다.
- 시작부터 있던 추적되지 않은 `src/`, `test/`, `scripts/smoke.ts`, 루트 `tsconfig.json`은 수정·삭제·커밋하지 않았다.

## 6. 프릭션과 남은 일

[프릭션 로그](../friction/FRICTION_LOG.md)에 S3 결과를 이어 썼다. **새 F 번호는 없다.**
F-12 우회는 유지한다. 새 외부 제품·문서의 15분 이상 차단이나 검증된 문서 불일치는 없었다.
음성 인식 실험과 내부 fixture 매칭 문제는 측정/실패 자료로 남겼다.

남은 일:

1. 사람 발화·실제 마이크/스피커·부엌 소음·연속 녹음과 실제 조리 캘리브레이션.
2. 정확도를 유지하면서 STT p95 1초, 모델 p95 2.5초를 맞추는 추가 경량화/하드웨어 측정.
   현재 p95 예산 충족을 주장하지 않는다. tiny/context 축소는 정확도 손실로 제외했다.
3. S4의 공통 YAML 4시나리오 runner와 전체 swap/thanksgiving 음성 E2E.
4. S6 승인 후 Polly/Transcribe 실제 검증, Bedrock 검증. macOS say·실제 오디오 장치도 별도 확인.
5. S7 gateway 마이크 업로드/오디오 전송과 UI. 타이머·대화의 프로세스 재시작 복원은 아직 없다.

## 7. 로컬 커밋과 실행

| 커밋 | 내용 |
| --- | --- |
| `e51e5e4` | 음성 툴 handoff·문맥 축소·스트리밍 측정·시계 기반 타이머 |
| `7d85bb8` | 음성 workspace·로컬/AWS mock 어댑터·WAV·CLI·무인 데모·안내 |
| `e6dc151` | 카탈로그 갱신 때 진행 계획 보존·오류/인식 어댑터 회귀 검사 |
| 결과 문서 커밋 | 측정 원본·검사 로그·프릭션·이 보고서 |

```sh
npm ci
npm run check
npm run voice:setup       # OS 도구가 설치된 뒤; 무료 whisper.cpp/base.en 다운로드
# 별도 터미널에서 README 명령으로 whisper-server 실행
export WHISPER_SERVER_URL=http://127.0.0.1:18080
npm run voice:roundtrip
npm run voice:demo -- --scenario weekday-3 --speed 60
# 로컬 모델 selector와 OPENAI_BASE_URL을 설정한 뒤:
npm run voice:latency
npm run dev              # 별도 터미널
npm run voice
```

두 자동 음성 검사만 묶어 실행하려면 `npm run voice:check`를 쓴다.
`.env.example`에는 자리표시자와 로컬 기본값만 있고 비밀값은 없다.
이 보고서는 요청한 **`../RESULT_S3.md`에도 동일하게 복사**했다.
**push·배포·가입·결제·외부 메시지 전송·AWS 실제 호출은 하지 않았다.**
