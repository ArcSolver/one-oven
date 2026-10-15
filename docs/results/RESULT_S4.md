# One Oven 4단계 구현 결과

작성: 2026-10-15 KST. 저장소: `one-oven`, `main`.
기준: `../DESIGN.md` 전체, 특히 6절(4단계 — 시나리오 자동 E2E)과 부록 A-4. 요청한 `../RESULT_S2.md`는 이 작업 공간에 없어서
레포 안의 [RESULT_S2.md](RESULT_S2.md)와 `../RESULT_S3.md`를 읽었다.

**4개 YAML 시나리오를 engine·mcp·agent·voice 네 모드에서 같은 러너로 돌리고, 4단계 완료 기준을 모두 통과했다.**
로컬 실모델 4 시나리오 × 5회는 **19/20**(5·5·5·4)으로 시나리오별 합격선 4/5를 넘었다.
실제 로컬 Whisper와 실모델을 쓴 음성 실행 4/4에서 **2:19 분량 영어 영상 대본**을 생성했다.
시나리오를 돌리면서 제품 결함 1건과 실모델 실패 2건이 드러났고 모두 고쳤으며 회귀 테스트를 붙였다.
Bedrock·AWS 호출, 유료 STT/TTS, push·배포·가입·결제는 하지 않았다.

## 1. 만든 것

새 workspace `packages/scenarios`([README](../../packages/scenarios/README.md)):

- `scenarios/*.yaml` 4개: weekday-3, salmon-delay, swap, thanksgiving-8. 사용자 발화가 곧 영상 대사다.
- `src/schema.ts`: 설계 6절의 Scenario/Beat를 zod로 검증한다(알 수 없는 키·잘못된 시각·모호한 비트 거절). 확장 필드는 5절에 적었다.
- `src/harness.ts`: 서버를 프로세스 안에서 띄우고 SimClock을 **서비스에만** 주입한다. HTTP 앱은 프로덕션 앱 그대로라 `/dev/clock` 경로가 없다.
- `src/runner.ts`: 비트마다 시계 이동 → 턴 실행 → 판정. 판정 항목은 툴 호출의 순서 있는 부분 일치, 툴 오류 0,
  원문·최종 음성 린트 0, 매 턴 독립 검증기(`verifyPlan`) 통과, 비트별 상태 기대값, 응답 문구다.
  실패는 tool_selection·arguments·tool_error·speech_lint·state·reply·turn_error로 분류한다.
- 모드 4개:

| 모드 | 경로 | 실행 |
| --- | --- | --- |
| engine | MCP 툴 디스패처로 Service 직접 호출 | `npm run check` |
| mcp | MCP SDK Client → Streamable HTTP → 서버, YAML의 툴을 그대로 호출 | `npm run check` |
| agent | Strands Agent → McpClient → HTTP 서버. 기본은 scripted, `--live`면 로컬 실모델 | check(scripted), `npm run e2e:live` |
| voice | 대사를 espeak WAV로 합성 → 로컬 Whisper → 같은 에이전트 → 시스템 TTS 파일, 호스트 타이머 알림 | `npm run e2e:voice` |

- `src/scripted.ts`: 비트의 기대 툴 호출로 준비되는 결정적 모델. Strands→MCP→HTTP 전 경로를 그대로 지나고,
  발화(음성 모드에서는 인식 결과)에 의도 단어가 빠지면 툴을 부르지 않고 되묻는다. 배관과 상태를 증명할 뿐 언어 이해는 증명하지 않으며, 그 부분은 live 실행이 맡는다.
- `src/report.ts`: `runs/scenarios/<id>/<시각>-<모드>/{report.md, report.json, transcript.md, trace.jsonl, timings.csv}`.
- `src/video-script.ts`, `npm run video:script`: 시나리오마다 가장 좋은 통과 실행(voice-live > agent-live > voice > agent > mcp > engine)을 골라
  [VIDEO_SCRIPT.md](../../docs/submission/VIDEO_SCRIPT.md)와 [SRT](../../docs/submission/VIDEO_SCRIPT.srt)를 만든다. 2:50을 넘으면 실패한다.
- `scripts/aggregate.ts`: 실행 요약에서 통과율·지연 표를 만든다.

서버·에이전트 수정(4절 상세): 같은 분에 시작할 단계를 모두 시작하고 두 번째 단계도 말하기, 지연·교체·주방 문장 개선,
음성 모드에서 지어낸 ID 1회 교정, 음성 프롬프트 두 줄. MCP 툴은 **여전히 6개**다.

## 2. 시나리오와 영상 대본 초안

| 시나리오 | 기기 | 주방 | 핵심 비트 | 상태 판정 |
| --- | --- | --- | --- | --- |
| weekday-3 | show | 오븐 1·화구 4·1명, 17:05 | 계획 → 17:55 예열 → 조리 끝까지 | 6:30 PM, 예열 단계 존재, 전 단계 완료, 경고 0 |
| salmon-delay | dot | 같음 | 18:20 연어 굽는 중 5분 지연 → 같은 말 반복 | 6:35 PM, 변경은 salmon:1·salmon:2만, 밥·콩 불변, 버전 +1 / 반복은 deduplicated·버전 +0 |
| swap | show | 같음 | 17:10 시작 전 green beans → glazed carrots | 같은 plan_id, 버전 +1, 6:30 PM, 연어·밥 불변, 경고 0 |
| thanksgiving-8 | show | 오븐 1(용량 4)·화구 4·2명, 12:00 | 8요리 16:00 계획 → 끝까지 | 4:00 PM, 예열과 온도 전환 존재, 칠면조 휴지(turkey:2)와 감자·스터핑 오븐 단계 겹침, 경고 0 |

영상 대본은 **voice-live 실행 4개**(espeak 음성 → Whisper base.en → local-openai-compatible → 서버)에서 생성했다. 예상 길이 **2:19**.
Alexa 대사는 이 에뮬레이터가 실제로 낸 문장이다. 실제 Alexa+는 반환 데이터로 문장을 직접 만들기 때문에 기기 문구는 다를 수 있다고 대본 머리말에 적었다.

| 시각 | 화자 | 대사 |
| --- | --- | --- |
| 0:00 | Title | One Oven: every dish on the table at the same time. *(Simulated Alexa+ experience)* |
| 0:04 | Narrator | One cook, one oven, three dishes that all need to be hot at six thirty. |
| 0:10 | User | Alexa, I have one oven, four burners, and one cook. |
| 0:15 | Alexa | Your kitchen has 1 oven that holds 4 pans, 4 burners and 1 cook. |
| 0:21 | User | Alexa, I want salmon, rice and green beans on the table at 6:30. |
| 0:27 | Alexa | Start at 5:55 PM. Set the oven to 400°F. |
| 0:31 | User | Alexa, what's next? *(5:55 PM로 타임랩스)* |
| 0:33 | Alexa | Set the oven to 400°F now. |
| 0:36 | — | 35분 조리 타임랩스(풀스크린 Run of Show), 타이머 차임 "Your fluffy rice timer is done." |
| 0:46 | User | I'm done with the salmon. What's next? |
| 0:50 | Alexa | All steps are complete. Your meal is ready. |
| 0:54 | Narrator | Kitchens slip. Same dinner, on a speaker with no screen. |
| 0:58 | User | Alexa, the salmon needs five more minutes. |
| 1:02 | Alexa | Dinner moves to 6:35 PM. The lemon salmon gets 5 more minutes; the other dishes keep their times. |
| 1:10 | User | The salmon needs five more minutes. |
| 1:13 | Alexa | I already added 5 minutes to the salmon. Say 'add 5 more' if you need more time. |
| 1:21 | Narrator | Out of green beans? Change the plan, not the whole evening. |
| 1:26 | User | Alexa, replace the green beans with glazed carrots. |
| 1:29 | Alexa | Glazed carrots replace green beans. Dinner is still at 6:30 PM. |
| 1:35 | Narrator | Now the hard one. Thanksgiving, eight dishes, one oven. |
| 1:39 | User | Alexa, plan Thanksgiving dinner for 4 PM with turkey, salmon, roasted potatoes, stuffing, rice, green beans, glazed carrots and gravy. |
| 1:47 | Alexa | Start in 17 minutes. Prepare the turkey tray. *(풀스크린: 8 dishes, 1 oven, 0 warnings)* |
| 1:51 | — | 4시간 타임랩스, 차임 "Your turkey centerpiece timer is done." |
| 2:01 | User | I'm done with the turkey. What's next? |
| 2:05 | Alexa | All steps are complete. Your meal is ready. |
| 2:09 | Narrator | Four scenarios, 95 tool calls over MCP, every plan checked by an independent verifier. Tool round trip p95 11 milliseconds on a local machine. |

장면별 촬영 지시(shot), 화면(inline/fullscreen/dot), 자막은 VIDEO_SCRIPT.md에 있다. 길이는 분당 150단어와 줄마다 짧은 쉼, 타임랩스 6초로 추정했다.

## 3. 테스트 결과

### 3-1. 결정적 검사(`npm run check`)

새 클론에서 `npm ci && npm run check` 통과(기준 `373c1d8`, [로그](CHECK_S4_CLEAN.log)).

| 항목 | 결과 |
| --- | --- |
| 단위·통합 테스트 | **64개 통과**, 실패 0: 서버 36(+2) · 에이전트 13(+1) · 음성 9 · 시나리오 6(신규) |
| 레시피 검증, HTTP smoke, S2 scripted 텍스트 E2E | 통과 |
| 시나리오 engine / mcp / agent(scripted) | **12/12** 통과. MCP 협상 버전 2025-11-25 확인 |
| 툴 왕복 p95(로컬) | engine 1.5–7ms, mcp 3–8ms, agent(scripted) 턴 p95 10–21ms |

시나리오 테스트는 스키마 거절, 인자 일치 규칙, **러너가 실제로 실패하는지**(틀린 상태 기대값 → state, 의도 단어가 빠진 발화 → tool_selection),
scripted 4개 실행으로 만든 대본의 길이 상한을 검사한다.

### 3-2. 실모델(로컬 OpenAI 호환 `http://127.0.0.1:10100/v1`, `local-openai-compatible`)

조건: temperature 0, maxTokens 2048, 음성 모드 응답(턴당 모델 요청 1회), 매 회 새 SQLite·서버·세션, 순차 실행.

수정 후 최종([집계](s4/LIVE_AFTER_FIX_METRICS.json)):

| 시나리오 | 통과 | 턴 | 턴 p50 | 턴 p95 | 최대 | 툴 p95 | 린트 위반 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| weekday-3 | **5/5** | 90 | 2.61s | 3.72s | 8.01s | 9.7ms | 0 |
| salmon-delay | **5/5** | 100 | 2.58s | 3.41s | 3.64s | 8.2ms | 0 |
| swap | **5/5** | 85 | 2.51s | 3.29s | 4.02s | 7.3ms | 0 |
| thanksgiving-8 | **4/5** | 160 | 2.41s | 3.19s | 4.93s | 8.7ms | 0 |

지연 통계는 통과한 실행의 턴만 집계했다. 실패 1건은 4절에 따로 적었다. 실모델 문구 차이(soft)는 0건이다.
수정 전 첫 세트는 18/20(thanksgiving 3/5)이었다([집계](s4/LIVE_BEFORE_FIX_METRICS.json), [실패 턴](s4/LIVE_FAILURES_BEFORE_FIX.jsonl)).
프롬프트를 바꿨으므로 이미 5/5였던 세 시나리오도 다시 돌렸다. 대표 대화: [지연](s4/TRANSCRIPT_SALMON_DELAY_LIVE.md), [추수감사절](s4/TRANSCRIPT_THANKSGIVING_LIVE.md).

### 3-3. 음성 모드

| 실행 | 결과 | 턴 p50 / p95 |
| --- | --- | --- |
| scripted 에이전트 + 실제 Whisper·espeak | **4/4** 통과 | 1.37–1.57s / 1.62–1.87s |
| **실모델 + 실제 Whisper·espeak** | **4/4** 통과, 95턴 | 3.84s / 4.89s(최대 7.82s) |

실모델 음성 95턴의 구간별 지연: STT p50/p95 1.38/1.61s, 모델 2.29/3.35s, MCP 툴 7/11ms, TTS 합성 91/119ms,
입력 WAV → 출력 오디오 파일 준비 3.84/4.89s([집계](s4/VOICE_LIVE_METRICS.json)).
S3와 같이 헤드리스라 물리적 첫 소리가 아니라 파일 준비 시점이다. 인식 결과가 대본과 다른 턴은 4/95였고 모두 의미는 같았다
("6:30" → "six thirty" 3회, "Thanksgiving" → "plant-thunk-sgiving" 1회, 모델은 정상 처리). 타이머 알림은 계획 시각과 0ms 차이로 울렸다.

### 3-4. 이전 단계 회귀

| 항목 | 결과 |
| --- | --- |
| S3 Whisper 12개 WAV 왕복(힌트 목록 변경 후) | **12/12** |
| S3 `voice:demo weekday-3 --speed 60` | 통과: 20턴, 12단계, 타이머 12회, 최대 오차 0ms, 6:35 PM |
| S2 `e2e:text`, 골든 4개, 1,000회 속성 검사, 성능 검사 | check 안에서 통과(골든 불변) |

## 4. 실패 분류와 고친 내용

| # | 어디서 | 분류 | 원인 | 고친 내용 |
| --- | --- | --- | --- | --- |
| 1 | engine: swap, thanksgiving | state | 같은 분에 시작할 단계가 둘이면(6:10 당근 손질과 밥 뜸) next_step이 하나만 시작했다. 두 번째 "What's next?"는 20초 암묵 재시도 감지에 걸려 재생됐고 밥 단계는 안내되지 않았다. 실제 사용자에게도 생기는 제품 결함이다 | 서버가 예정 시각이 된 단계를 모두 시작하고 "Slice the carrots. Also, cook the covered rice gently."처럼 두 번째 단계도 말한다(린트를 통과할 때만). 응답에 `also_started` 추가. [speech.test.ts](../../packages/server/test/speech.test.ts) |
| 2 | 대본 검토 | 문구 | 지연 응답이 이미 오븐에 든 연어를 "Lemon salmon starts 5 minutes later"라고 말했다(연어 휴지 단계 이동을 다른 요리 변화처럼 요약). 교체는 "The replacement is planned", 주방은 "capacity 4 pans respectively" | 지연: 다른 요리 변화만 요약, 없으면 "the other dishes keep their times", 서빙 시각이 그대로면 "stays". 교체·주방 문장에 실제 이름·수치를 넣었다 |
| 3 | voice(scripted) 첫 실행 0/4 | tool_selection | espeak 음성 + base.en이 "Alexa, my kitchen has one oven"을 "my kitchen, oven"으로, "turkey step"을 "Turkish tap"으로, "gravy"를 "bravest"로 들었다 | 인식되는 자연스러운 대사로 교체("I have one oven…", "replace … with …", 완료 문장 "I'm done with the {subject}"는 10개 대상 10/10). 공통 힌트에 카탈로그 요리 이름만 추가(발화별 정답은 넣지 않음). scripted 의도 검사는 단·복수를 허용. S3 12/12 유지 |
| 4 | live thanksgiving t1 | arguments | 모델이 `done_step_id: "potatoes:0 / end"`를 보냈고, 음성 모드가 오류 문장을 바로 말해 모델이 고칠 기회가 없었다 | 실패한 호출의 ID가 호스트가 준 적 없는 값이면 오류를 말하지 않고 모델에 **한 번** 돌려준다(`voice_correction` trace). 유효한 ID로 난 진짜 도메인 오류는 기존대로 모델 요청 1회로 즉시 말한다. [correction.test.ts](../../packages/agent/test/correction.test.ts) |
| 5 | live thanksgiving t4 | tool_selection | 식사 요청에 모델이 set_kitchen을 다시 불렀고(서버가 dedup), 음성 모드는 그 응답으로 턴을 끝냈다 | 음성 프롬프트에 두 줄 추가: ID를 그대로 복사하라, 주방을 묘사할 때만 set_kitchen을 쓰고 kitchen_id가 있으면 plan_meal을 부르라 |
| 6 | live thanksgiving t4(수정 후) | turn_error | 모델 요청 1건이 120초 동안 응답하지 않았다. 툴 호출 0, 상태 변화 0. S2 2회차와 같은 유형이다 | 코드 수정 없음. 7절 남은 일 |

수정 후 세트에서 교정 경로는 한 번도 발동하지 않았고 4·5번 유형도 재발하지 않았다. 프롬프트 규칙이 효과를 냈을 가능성이 크지만 5회 표본으로 단정하지는 않는다.

## 5. 설계와 달라진 점 / 구체화

- **스키마 확장.** 조리 진행 비트를 수십 개 손으로 쓰지 않으려고 `repeat`(until: all_done | {running} | {at}, `{subject}` 대사, `user_idle`)를 넣었다.
  러너가 방금 끝난 단계로 대사를 만들고 next_step(done_step_id)을 기대한다. 그 밖에 `intents`, 상태 확장(deduplicated, version_delta, same_plan, all_done, system_steps, overlaps),
  `video.timer`, `scenario.date`·`video.{order, scene, intro}`, `user_idle`을 더했다.
- **scripted 모델.** S2의 weekday 정규식 모델은 `e2e:text`용으로 두고, 시나리오용은 YAML 기대 호출로 준비하는 모델을 새로 만들었다.
- **agent 모드 기본은 음성 모드 응답**(서버 say를 말함, 턴당 모델 1회)이다. `AGENT_VOICE_MODE=0`이면 모델이 문장을 만든다. 영상이 음성 데모이고 S3의 지연 최적화 경로이기 때문이다.
- live에서는 `reply_includes` 차이를 실패로 보지 않고 기록만 한다(설계 "문장은 린트로만").
- 영상 대본 소스는 설계의 "통과한 live 실행"을 voice-live 우선으로 구체화했다. Alexa 대사가 에뮬레이터 출력이라는 점을 대본에 명시했다.
- **서버 동작 변경**: 같은 분 단계 동시 시작과 문장 개선(4절 1·2). 툴 수·입력 스키마는 그대로이고, 응답에 `also_started`만 늘었다. 골든 스냅샷은 바뀌지 않았다.
- **에이전트 변경**: 음성 모드의 지어낸 ID 1회 교정과 프롬프트 두 줄(4절 4·5).
- 명령: `e2e:live`는 이제 시나리오 live(4×5)다. S2의 weekday live는 `e2e:text:live`로 옮겼다. `e2e:scenarios`, `e2e:voice`, `video:script`를 추가했다.
- 산출물 경로는 `runs/<scenario>/<ts>/` 대신 `runs/scenarios/<scenario>/<ts>-<mode>/`다(모드·회차 구분).
- 음성 모드의 사용자 WAV는 레포에 커밋한 fixture 대신 실행 때 espeak로 합성하고 `input/`에 남긴다. 대사를 바꿔도 재생성이 필요 없다.
- 설계 8단계 일부(SRT 자막)를 앞당겼다. 촬영 목록·내레이션 음성은 8단계에 남겼다.
- 시작부터 있던 추적되지 않은 `src/`, `test/`, `scripts/smoke.ts`, 루트 `tsconfig.json`은 건드리지 않았다.

## 6. 프릭션 로그

[FRICTION_LOG.md](../../docs/friction/FRICTION_LOG.md)에 S4 절을 이어 썼다.

- **F-09 실증**([항목](../../docs/friction/entries/F-09-alexa-timer-handoff-contract.md)): 애드온이 Alexa 기본 타이머로 넘기는 계약이 확인한 문서에 없다.
  Conversation surface 가이드는 타이머를 호스트 쪽 끼어들기 예시로만 다룬다("A: <Timer audio and visuals play> C: “Alexa, stop the timer.”").
  같은 문서의 "You influence Alexa’s response through the data you return, not by scripting it directly."는 결함이 아니라 제약이라 대본 머리말에 반영했다.
- 새 F 번호는 없다. 로컬 합성 음성 인식 한계와 같은 분 단계 결함은 외부 제품 문제가 아니라서 결과 문서에만 남겼다.

## 7. 남은 일

1. **촬영 전 7단계 UI가 필요하다.** 대본의 Screen 열(인라인 Now 카드, 풀스크린 Run of Show, 지연 막대 이동)은 아직 없는 화면이다.
2. 사람 목소리·실제 마이크/스피커로 같은 대사를 녹음하고 실제 조리 캘리브레이션을 한다(부엌 장면). 합성 음성 결과를 사람 음성으로 일반화하지 않는다.
3. 모델 요청 무응답(S2·S4 각 1건): 스트리밍 첫 응답 타임아웃과, 툴을 부르지 않은 턴에 한한 1회 재시도를 검토한다.
4. 음성 지연: STT p95 1.61s(목표 1.0s), 모델 p95 3.35s(목표 2.5s)로 S3와 같은 수준이다. 하드웨어나 더 빠른 모델로 다시 잰다.
5. S6에서 같은 러너로 Bedrock 4×5를 돌린다. 지금 `--live`는 로컬 엔드포인트만 허용하므로, 승인 후 bedrock을 여는 명시적 옵션을 추가해야 한다.
6. S8: 내레이션 음성(Polly 또는 사람), 촬영 목록, 편집 후 실제 길이 측정. 2:19는 추정치다.

## 8. 로컬 커밋과 실행

| 커밋 | 내용 |
| --- | --- |
| `761de2b` | 같은 분 단계 동시 시작, 지연·교체·주방 문장 개선, 서버 테스트 2개 |
| `a4a4ca8` | packages/scenarios: 스키마, YAML 4개, 러너, 모드 4개, 리포트, 대본 생성, 테스트; check 연결; STT 공통 힌트 |
| `a73102c` | F-09 프릭션, 시나리오 README |
| `df45ec5` | 음성 모드 지어낸 ID 1회 교정, 프롬프트 규칙, 에이전트 테스트 |
| `bd66888` | 수정 전후 live 결과·실패 턴·대표 대화, 집계 스크립트, README |
| `373c1d8` | voice-live에서 생성한 VIDEO_SCRIPT.md·.srt |
| 결과 문서 커밋 | 이 보고서와 새 클론 check 로그 |

커밋 작성자는 이전 단계와 같이 커밋마다 지정했고 전역 git 설정은 바꾸지 않았다.

```sh
npm ci
npm run check                                   # 64 tests + smoke + e2e:text + 4 scenarios x 3 modes
AGENT_MODEL=openai:local-openai-compatible OPENAI_BASE_URL=http://127.0.0.1:10100/v1 npm run e2e:live
npm run voice:setup                             # 무료 whisper.cpp + base.en, 계정 불필요
.local/voice/whisper.cpp/build/bin/whisper-server -m .local/voice/models/ggml-base.en.bin --host 127.0.0.1 --port 18080 -t 4 -bs 1 -bo 1 -nc
WHISPER_SERVER_URL=http://127.0.0.1:18080 npm run e2e:voice            # scripted 에이전트
WHISPER_SERVER_URL=http://127.0.0.1:18080 AGENT_MODEL=… OPENAI_BASE_URL=… npm run e2e:voice -- --live --runs 1 --required 1
npm run video:script
```
