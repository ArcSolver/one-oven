# One Oven 2단계 구현 결과

작성: 2026-10-15 KST. 저장소: `one-oven`, `main`.
기준: `../DESIGN.md` 전체, 특히 4절·부록 A-2·공통 계약·프릭션 운영 규칙, `../RESULT_S1.md`.

## 1. S2-0 경로 결정: A

**Strands TypeScript의 내장 공급자를 쓰는 경로 A로 구현했다.**
스파이크에서 npm registry 최신 `@strands-agents/sdk@1.21.0`을 설치하고 실제 export와 타입을 확인했다.

| 확인 대상 | 설치된 SDK의 근거 | 결과 |
| --- | --- | --- |
| OpenAI 호환 공급자 | `dist/src/models/openai/index.d.ts`: `OpenAIModel`; `types.d.ts`: `OpenAIModelOptions`, `api: 'chat'`, `clientConfig.baseURL` | 제공됨 |
| Anthropic 공급자 | `dist/src/models/anthropic.d.ts`: `AnthropicModel` | 제공됨, 생성자만 검사 |
| Bedrock 공급자 | `dist/src/models/bedrock.d.ts`: `BedrockModel` | 제공됨, 생성자만 검사 |
| 커스텀 모델 | `dist/src/models/model.d.ts`: 공개 abstract `Model`, `stream`, `getConfig`, `updateConfig` | scripted 모델에 사용 |
| HTTP MCP | `dist/src/mcp/client.d.ts`: `McpClient`, legacy transport를 받는 `McpTransport` | 실제 연결 성공 |
| 협상·발견 | `packages/agent/scripts/spike.ts` → 로컬 HTTP 서버 | protocol `2025-11-25`, tools/list 6개, tools/call 성공 |

Strands 내부는 `@modelcontextprotocol/client@2.3.1`, 서버와 명시적 transport는
`@modelcontextprotocol/sdk@1.32.1`이다. 이 조합을 실제 HTTP로 검증했다.
공급자가 있으므로 B의 자체 API 공급자는 필요 없고, HTTP와 Model 계약이 열려 있으므로 C도 필요 없다.
OpenAI SDK는 `6.49.0`, Anthropic SDK는 `0.109.1`로 lockfile에 고정됐다.

스파이크에서 **native McpTool이 structuredContent를 모델에게 전달하지 않는 문제**도 재현했다.
`OneOvenMcpClient.callTool()`의 공개 override로 모델용 content에 구조화 JSON을 덧붙인다.
원래 응답은 trace에 그대로 남긴다. 공급자는 내장 구현을 사용하므로 경로는 여전히 A다.
상세 근거와 재현 출력: [S2_SPIKE.md](S2_SPIKE.md), [F-12](../../friction/entries/F-12-strands-structured-content.md).
공식 확인 자료: [Strands MCP transports](https://strandsagents.com/docs/user-guide/sdk/tools/mcp-transports/),
[TypeScript SDK 소스](https://github.com/strands-agents/sdk-typescript).

## 2. 만든 것

- `packages/agent` workspace: `config.ts`, `models.ts`, `models/scripted.ts`, `mcp.ts`,
  `host-tools.ts`, `prompt.ts`, `session.ts`, `speech-lint.ts`, `trace.ts`, `model-metadata.ts`,
  `runtime.ts`, `cli.ts`, `gateway.ts`.
- `AGENT_MODEL=scripted:weekday-3 | openai:<id> | anthropic:<id> | bedrock:<id>`.
  자격 증명·엔드포인트·리전을 준비한 뒤 이 한 줄만 바꾸면 공급자가 전환된다.
  실제 클라우드 모델 ID는 코드나 `.env.example`의 기본값에 넣지 않았다.
- 개발 실모델은 사용자가 지정한 **`http://127.0.0.1:10100/v1`**을 사용했다.
  `/v1/models`에서 확인한 로컬 OpenAI 호환 모델을 실행 환경변수로 선택했다.
  키 없는 루프백에는 더미 키를 사용한다. 별도 가입·결제·API 키 발급은 하지 않았다.
- Strands `Agent` → `McpClient` → `StreamableHTTPClientTransport` → 로컬 서버가 실제로 연결된다.
  결정적 모델도 같은 에이전트 루프와 HTTP 경로를 사용한다.
- 매 모델 호출에 마지막 kitchen/plan ID, 버전·계획 상태, 기기·시간대·현재 시각·타이머 상태를 주입한다.
  `next`, 구체적인 완료 발화, 지연·중복 요청을 처리한다. 계획은 서버만 계산한다.
- 호스트의 `set_timer`, `cancel_timer`, `list_timers`: Clock 주입, 교체·취소·잔여 시간·elapsed 상태.
  실모델이 제안에 따라 타이머를 호출한다. scripted E2E는 자동 타이머를 사용하며
  같은 step/end-time을 다시 받으면 재설정하지 않는다. **MCP 서버 툴은 여전히 6개다.**
- 원문과 최종 음성 각각을 린트한다. 원문이 틀리면 정상 tool say로 보정하되,
  trace에 `rawReply`, `rawLint`, `fallback`을 남기고 live 판정에서는 원문 위반도 실패 처리한다.
- JSONL에 협상 버전·툴 발견·발화·툴 인자/결과·왕복 시간·모델 토큰/시간·호스트 동작을 기록한다.
  공급자 응답 헤더의 request ID 수집 경로를 구현했다. Bedrock ID는 실호출하지 않아 이번 증거에 없다.
- `npm run chat`: `:dot`, `:show`, `:advance 10`, `:quit`.
  `npm run gateway`: `POST /session/:id/turn`, JSON 또는 SSE의 start/turn/error 이벤트.
  같은 세션의 동시 턴은 409, 세션 삭제와 최대 32세션 제한, 실패 응답·정리를 구현했다.
- 공용 `Clock`, `SystemClock`, `SimClock`. 서버의 `/dev/clock`은 명시적 옵션으로 켠 경우에만 생긴다.
  루프백·Origin·양수/0 시계 이동을 검사한다. 일반 서버에서는 404다.
- `npm run e2e:text`는 항상 키 없는 scripted로 돈다. `e2e:live`는 명시적인 local OpenAI 모델만 받는다.
  scripted를 실모델 성공으로 잘못 보고하지 않도록 `--live`+scripted를 거절한다.

## 3. 테스트와 완료 기준

**S2 완료 기준을 통과했다.**

| 기준 | 결과 |
| --- | --- |
| S2-0 공급자·공개 Model·HTTP MCP 확인 | 통과, 경로 A |
| 기존 S1 검사 유지 | 테스트 34개, 1,000회 속성 검사, 4개 골든, HTTP smoke 통과 |
| 새 에이전트 테스트 | **10개 통과, 실패/생략 0** |
| scripted 텍스트 E2E | **20턴, MCP 호출 20회, 12단계 완료, 최종 버전 18** |
| 지연·중복·다른 요리 고정 | 연어 5분 연장, salmon:1·salmon:2만 변경, 중복 버전 불변 |
| 최종 서버 상태 | 6:35 PM, 모든 레시피·예열 단계 done, 경고 0 |
| 실모델 같은 흐름 5회 | **4/5 성공**, 합격선 ≥4 |
| 린트 | 최종 평가의 반환 90턴 전체에서 원문 0·최종 출력 0·fallback 0 |
| 공급자 전환 | 동일 파서·팩터리에서 selector만 교체하여 4종 객체 생성; scripted/OpenAI는 같은 E2E runner |
| Bedrock | 객체 생성·설정만 검사, stream/invoke/countTokens **실행 없음**, AWS 호출 0 |
| HTTP/SSE·REPL | 실제 MCP를 붙인 JSON/SSE 세션, 오류·동시성, 컴파일된 CLI 명령 통과 |
| 일반 서버의 시계 조작 차단 | `/dev/clock` 없음, opt-in 서버의 역행/외부 Origin 거절 |
| 새 로컬 복제본 | **`npm ci && npm run check` 통과**, 기준 커밋 `ae4f699` |

새 복제본 로그는 [CHECK_S2_CLEAN.log](../../results/CHECK_S2_CLEAN.log)다.
그 뒤 live 명령의 scripted 오설정 거절을 추가하고 빌드·거절 동작을 별도로 검사했다.
최종 작업 트리에서도 전체 check를 다시 실행했다([CHECK_S2.log](../../results/CHECK_S2.log)).
총 자동 테스트는 **S1 34개 + S2 10개 = 44개**다.

새 복제본 scripted 측정: 턴 p50 **9.04ms**, p95 **14.62ms**, 전체 **356.08ms**.
기존 파일 SQLite 성능 검사: plan p95 **3.805ms**(기준 50ms), delay p95 **4.690ms**(기준 20ms).
속성 검사는 seed 20261015, 1,000회, 검증기 위반 **0건**이다.

## 4. 실모델 결과와 실패 분류

조건: 로컬 OpenAI 호환 모델, temperature 0,
maxTokens 2048, Dot, America/Chicago, 모의 시계 2026-10-15 17:05,
매 회 새 SQLite·MCP 서버·대화 세션, 호출 순차 실행. AWS는 사용하지 않았다.

| 회차 | 결과 | 완료 턴 | MCP 호출 | 턴 p50 | 턴 p95 | 전체 시간 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 성공 | 20 | 21 | 7.193s | 8.007s | 136.90s |
| 2 | 실패: 모델 응답 시간 초과 | 10 | 11 | — | — | 185.50s |
| 3 | 성공 | 20 | 21 | 6.931s | 8.359s | 145.97s |
| 4 | 성공 | 20 | 21 | 6.612s | 8.987s | 139.22s |
| 5 | 성공 | 20 | 21 | 6.422s | 8.312s | 131.39s |

성공한 실행의 MCP 호출은 설정 1 + 요리 조회 1 + 계획 1 + next_step 16 + 지연 2다.
호스트 타이머는 이 MCP 횟수에 포함하지 않았다.
최종 평가 전체: 반환 턴 90개, MCP 호출 95회, 호스트 동작 58회,
완료 모델 요청 243회. MCP 왕복 p50 **7.32ms**, p95 **14.56ms**, 최대 **28.99ms**.
반환된 턴의 p50 **6.933s**, p95 **8.359s**이며, 이 지연 통계는 실패한 120초 턴을 제외한다.
실패는 위 표와 trace에 별도로 남겼으므로 지연·성공률에 숨기지 않았다.

실패 내역:

1. **초기 평가 0/5: 인자 오류.** 모델이 선택 필드 `request_id`와 `based_on_version: 1`을
   만들어 set_kitchen이 version_conflict가 됐다. 모델에게 보이는 툴 스키마에서
   호스트 소유 두 필드를 제거하고, 사용하지 않는 선택값을 null로 표현할 수 있게 했다.
   MCP 전송 전에는 원래 계약에서 선택인 null만 제거한다. 필수값의 null은 그대로 오류가 난다.
   공급자별 다른 프롬프트나 기대 상태를 대신 만드는 코드는 넣지 않았다.
   실제 wire 응답을 보존한 [초기 실패 trace](../../results/s2/INITIAL_FAILURE_TRACE.jsonl)와
   [초기 5회 표](../../results/s2/INITIAL_FAILURES.json)를 남겼다. 엔드포인트 내부 원인까지 확인한 것은 아니다.
2. **최종 평가 2회차: 완료 10턴 뒤 "What's next?" 응답 지연.**
   120초 세션 제한에서 중단됐다. 해당 실패 턴의 MCP 호출은 0회라 그 턴에서 상태를 바꾸지 않았다.
   원격 내부 장애라고 단정할 근거는 없다. [실패 trace](../../results/s2/TIMEOUT_TRACE.jsonl)에
   모델 120036.92ms, 전체 120041.88ms가 기록돼 있다. 무제한 재시도는 하지 않았다.

최종 원본: `runs/s2-openai-2026-10-15T07-54-58-376Z/trial-1..5/trace.jsonl`.
보존한 집계: [LIVE_REPORT.json](../../results/s2/LIVE_REPORT.json), [LIVE_METRICS.json](../../results/s2/LIVE_METRICS.json).
실행 뒤 성공한 4개 최종 trace에서도 6:35 PM·12단계 done·경고 0을 다시 확인했다.
토큰 값은 공급자가 보고한 누적 입력 처리량이며 캐시·고유 텍스트량·청구 비용으로 해석하지 않는다.

## 5. Trace 샘플 3턴

1회차에서 발췌했다. 전체 필드와 원래 ID 체인은 [TRACE_SAMPLE.jsonl](../../results/s2/TRACE_SAMPLE.jsonl)에 있다.
아래 표의 응답은 모델 원문과 최종 발화가 같으며, 모두 린트 통과다.

| 턴 | 사용자 발화 | 실제 호출·결과 | 모델 응답 |
| --- | --- | --- | --- |
| 주방 설정 | My kitchen has one oven, four burners, and one cook. My timezone is America/Chicago. | set_kitchen(1,4,1,America/Chicago), 28.99ms | Your kitchen is set: one oven, four burners, and one cook, on Central Time. What would you like to cook? |
| 계획 | I want salmon, rice and green beans on the table at 6:30 PM. | list_dishes → plan_meal(salmon,rice,green-beans; 18:30; 앞서 받은 kitchen_id), 계획 왕복 14.56ms | To serve salmon, rice, and green beans at 6:30 PM, start at 5:55 PM by setting the oven to 400°F. |
| 지연 | The salmon needs five more minutes. | report_delay(기존 plan_id,salmon,5), 11.32ms → host set_timer | I've added five minutes to the salmon and updated its timer. Dinner moves to 6:35 PM. |

세 턴의 모델 요청 횟수는 2/3/3회, 합계 모델 시간은 각각 4371.00/7276.22/7862.13ms다.
음성에 ID·JSON·툴 이름·화면 단어를 노출하지 않았다.

## 6. 설계와 달라진 점 / 구체화

- 현재 폴더의 git `main`을 정본으로 사용했다. 시작부터 있던 추적되지 않은 옛 `src/`, `test/`,
  `scripts/smoke.ts`, 루트 `tsconfig.json`은 수정·삭제·커밋하지 않았다.
- native McpTool의 structuredContent 손실을 공개 override로 보완했다(F-12).
  server의 음성 content나 툴 6개 계약은 바꾸지 않았다.
- 모델용 schema의 호스트 소유 메타데이터를 제외하고 선택값의 null을 정규화했다.
  서버의 request_id/based_on_version 지원은 그대로이며 향후 웹·재시도 클라이언트가 직접 사용할 수 있다.
- 4단계에서 본격화할 SimClock 중 REPL `:advance`와 S2 E2E에 필요한 최소 부분을 앞당겼다.
  Clock 계약은 server/agent 공용이므로 contracts에 두고 server에서 재수출했다.
- SSE는 start·heartbeat·검증된 TurnResult를 보낸다. 아직 음성용 token/audio 스트리밍은 없다.
- E2E는 S2 전용 TypeScript weekday runner다. YAML 4개 시나리오와 공통 runner는 S4에 남긴다.
- S2 live 명령은 사용자 지정 로컬 OpenAI endpoint만 허용한다. 일반 세션 팩터리는
  Anthropic/Bedrock도 구성할 수 있지만 여기서 실호출하지 않았다.
- 사장님 API 키가 없어도 사용자 지시대로 더미 키로 실모델 5회를 실행했다.
- 결과에 raw/final lint·fallback·모델별 요청 배열을 추가하여 보정으로 실패를 숨기지 않게 했다.

## 7. 남은 일과 프릭션

- **새 프릭션은 F-12 한 건.** F-10 공급자 범위 씨앗은 “이번 버전에 내장 공급자 있음”으로 해소했다.
  초기 인자 선택과 시간 초과는 테스트 실패 분류로 남겼으며, 확인하지 않은 외부 제품 원인을 주장하지 않는다.
- S3: 음성 입출력, 타이머 만료 콜백·차임·발화. 현재는 메모리 타이머 상태까지만 구현했다.
- S4: YAML 4시나리오·공통 runner·영상 대본. 현재 scripted는 weekday-3 전용이다.
- S5: OAuth/PKCE, 다중 가구 인증·격리, 원격 배포 준비. 지금 HTTP gateway와 MCP는 로컬 데모다.
- S6: Bedrock 모델 접근·자격 증명·승인 후 실호출과 request ID 검증.
  Anthropic 경로도 생성 외의 실호출은 검증하지 않았다.
- 실모델 턴 지연이 6–9초여서 S3 음성 예산보다 길다. 여러 모델 왕복과 전체 대화/상태 중복을
  줄이는 작업이 필요하다. 이번에는 통과율을 위해 실패를 임의로 재생하거나 상태를 직접 수정하지 않았다.
- 세션·타이머의 재시작 복원, 인증된 원격 gateway, 실제 Alexa+ 호스트 검증은 아직 없다.
  조리 시간은 기존 fixture이며 실제 조리·식품 안전 검증을 완료했다고 주장하지 않는다.

## 8. 로컬 커밋과 실행

| 커밋 | 내용 |
| --- | --- |
| `a21be5f` | S2-0 설치·HTTP 스파이크·경로 A·F-12 |
| `0438a34` | 공급자·세션·MCP 어댑터·타이머·추적·공용 Clock |
| `ae4f699` | REPL·gateway·모의 시계·상태 E2E·테스트·실행 문서 |
| `4ad142a` | live 명령의 scripted 오설정 거절 |
| 결과 문서 커밋 | 이 문서·검증 로그·대표 trace |

커밋별 작성자 옵션을 사용했고 전역 설정은 바꾸지 않았다.

```sh
npm ci
npm run check
npm run e2e:text
npm run dev                     # 별도 터미널
npm run chat                    # .env의 AGENT_MODEL 사용
npm run gateway                 # 선택: HTTP/SSE
npm run spike -w @one-oven/agent
# .env에 로컬 OPENAI_BASE_URL과 실제 AGENT_MODEL을 설정한 뒤에만:
npm run e2e:live
```

`.env.example`에는 자리표시자만 있다. 상세 설정·요청 계약은 README에 적었다.
이 문서는 요청한 **`../RESULT_S2.md`에도 동일하게 복사**한다.
**push·배포·가입·결제·AWS 호출·외부 메시지 전송은 하지 않았다.**
