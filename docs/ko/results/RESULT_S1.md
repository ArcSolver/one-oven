# One Oven 1단계 구현 결과

작성일: 2026-10-15.
작업 저장소: `one-oven`, 브랜치 `main`.

**1단계 완료 기준을 통과했다.** 새 로컬 복제본에서 `npm ci && npm run check`를 실행해
빌드, 레시피 8개 검증, 테스트 34개, 실제 HTTP MCP smoke가 모두 성공했다.
원시 출력은 [CHECK_S1.log](../../results/CHECK_S1.log)에 보관했다.

## 만든 것

- `packages/contracts`, `packages/server` npm workspaces. 기존 파일은 `git mv`로 옮겼다.
  동작 변경 없는 첫 커밋에서 기존 테스트 11개와 smoke를 통과했다.
- Dish v2, Kitchen v2, OvenProfile, ScheduledStep, OvenSegment, Plan v2,
  ToolEnvelope, ToolError, ErrorCode의 Zod 스키마와 TypeScript 타입.
- 원작 레시피 8개를 JSON으로 분리했다. 필수 자원·온도·용량, 요리별 총시간 상한,
  영어 명령문, 상표 제외, 생선·가금류 안전 문구, 출처, 보관 품질 한도를 로드 시 검증한다.
- 엔진을 `engine/{types,schedule,oven,repair,verify,changes,time}.ts`로 분리했다.
  예열, 가열/냉각 전환, 25°F 온도 범위, 팬 용량, 5°F 단위 설정 온도,
  명시적인 시스템 단계, 진행/완료 단계 고정, 미시작 시스템 단계 재생성을 구현했다.
  배치 후보는 자원 경계와 온도 전환 시간으로 좁혔다.
- 독립 검증기는 손·화구·오븐 용량·온도, 열처리 길이와 겹침, 선후 관계,
  서빙 마감, 구간 메타데이터, 보관 경고를 검증한다. 엔진의 배치 판정 함수를 호출하지 않는다.
- SQLite `001_init.sql`, `002_household.sql`: households, kitchens, plans,
  plan_events, idempotency, schema_migrations. 서비스의 변경 전체를 한 번의
  `BEGIN IMMEDIATE`로 처리하며 오류 시 모두 롤백한다.
- `plan_events.changes`에 단계별 before/after와 전체 버전 스냅샷을 보관한다.
  `Store.events()`와 `Store.planVersion()`으로 과거 버전을 읽는다.
- 명시적 request_id, MCP `_meta` 키, 키 없는 20초 재시도 감지, allow_repeat,
  based_on_version 충돌을 구현했다. DB 재개방 후에도 명시적 키 응답을 복원한다.
- 주방 시간대의 `6:35 PM` 형식, 가까운 시작의 상대 시간, `say.ts`, 공용 speech-lint.
  정상/오류 모두 짧은 영어 음성 문장과 구조화 결과를 반환한다.
- 6개 MCP 툴, 2개 리소스 템플릿을 유지했다. 도구별 설명은 2문장 이하이며,
  읽기/변경 annotations와 새 입력 스키마를 반영했다.
- 프릭션 로그 템플릿·인덱스·번호 생성 명령, 실측 캘리브레이션 기록 틀,
  README, `.env.example`, 빌드 시 JSON/SQL 자산 복사를 추가했다.

## 완료 기준 대조

| 설계 기준 | 결과 / 근거 |
| --- | --- |
| 첫 이동 커밋에서 기존 11개와 smoke 유지 | 통과 |
| 예열을 포함한 시작 시각이 now 이후 | 서비스 검사 및 too-late 오류 테스트 통과 |
| 연어만 계획할 때 첫 단계 예열 | 400°F까지 14분, 굽기 전에 완료 |
| 온도 상승·하강 전환 중 오븐 비움 | 두 방향 테스트 통과, 325→400°F 3분 기준 포함 |
| 용량 2에서 2 units 요리 2개 동시 사용 금지 | 통과 |
| 감자 400°F·2, 스터핑 375°F·2 공유 | 용량 4에서 공유, 설정 온도 390°F |
| 진행·완료 단계 고정 / 변경 부분만 반환 | 기존 회귀, 속성 테스트, 실시간 툴 시나리오 통과 |
| 보관 경고 일치 / 데모 경고 0 | 검증기 음성/데이터 검사와 4개 전체 실행 통과 |
| 1,000회 fast-check | seed 20261015, 불변식 위반 0 |
| 4개 골든 JSON | 초기·지연·교체·8요리 스냅샷 일치 |
| 같은 키는 한 번 적용, 다른 인자는 오류 | 버전/이벤트 횟수 및 응답 동등성 검증 통과 |
| 키 없는 20초 / allow_repeat / 버전 충돌 | 19,999ms·20,001ms, 새 버전, 강제 반복 검증 통과 |
| 이벤트·재시도 기록 실패 시 전부 롤백 | SQLite 실패 trigger 주입 테스트 통과 |
| 마이그레이션 / 재개방 | 실제 v1 파일, 누락된 온도 전환 보정, 새 DB 재개방 통과 |
| 주방 현지 시각 / speech-lint | UTC ISO·ID·도구·JSON·화면 단어 거절, 정상/오류 검사 통과 |
| DST / 다음 HH:MM | 자정 넘김·봄의 사라진 시각·가을의 반복 시각 테스트 통과 |
| 8요리 plan p95 ≤50ms, delay p95 ≤20ms | 아래 측정표 모두 통과 |
| npm run check | build → validate:recipes → test → smoke 통과 |

## 테스트 수치

- Node `v24.21.0`, npm `11.19.0`, Linux 로컬 환경. 외부 모델·클라우드 호출 없음.
- 기존 회귀 11개를 포함하여 **34개 통과 / 실패 0 / 생략 0**.
- fast-check **1,000회**: 생성 성공 849회, 지연 성공 827회, 교체 성공 344회.
  여러 작업을 포함한 시도에서 예상한 `infeasible_kitchen` 또는 `conflict_frozen` 거절은
  총 610건이다. 거절 시 저장 불변도 검사했다. 예상 밖 예외와 검증기 위반은 **0건**.
- HTTP smoke: MCP **2025-11-25**, 툴 **6개**, 호출 **24회**.
  평균 **5.44ms**, 최대 **22.65ms**. 이 수치는 로컬 HTTP 왕복이며 AWS 지연이 아니다.
- HTTP에서 `_meta` 키와 인자 키의 공통 네임스페이스, stale-version replay,
  schema/domain 오류 봉투, Origin 거절, 리소스 읽기, SQLite 재개방·이력·멱등 응답 복원을 확인했다.
- 별도 로컬 복제본에서 **`npm ci && npm run check` 통과**.
- 그 복제본의 **컴파일된 JavaScript 서버**도 실행했다. JSON/SQL 복사 자산을 사용한
  initialize, tools/list, list_dishes(8개), set_kitchen이 성공했다.
- `friction:new`로 임시 F-12/F-13을 생성해 순번과 템플릿을 확인하고 테스트 파일을 삭제했다.

### 성능

측정 대상은 서비스 호출 전체이며, 파일 기반 SQLite WAL의 계획·이벤트·idempotency 저장을 포함한다.
8요리, 오븐 1개·용량 4, 화구 4, 손 2. 워밍업 20회 뒤 각각 200회 측정했다.
`serve_at: "16:00"` 변환도 포함한다. 전체 check의 새 복제본 실행값이다.

| 호출 | N | p50 ms | p95 ms | p99 ms | 최대 ms | p95 기준 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| plan_meal | 200 | 2.731 | **4.377** | 11.353 | 40.865 | ≤50, 통과 |
| report_delay | 200 | 2.466 | **6.394** | 23.373 | 29.455 | ≤20, 통과 |

평가는 설계의 p95 기준이다. 모든 개별 호출이 20ms 이하라는 뜻은 아니다.

### 스냅샷 요약

위치: `packages/server/test/golden/*.json`. 임의 plan/kitchen ID만 고정 식별자로 치환하고,
시각·단계·상태·오븐 구간·경고·버전은 실제 서비스 결과를 저장했다.

| 시나리오 | 스냅샷 버전 | 레시피 / 시스템 단계 | 서빙 | 경고 |
| --- | ---: | --- | --- | ---: |
| weekday-3 | 1 | 11 / 1 | 6:30 PM | 0 |
| salmon-delay | 8 | 11 / 1 | 6:35 PM | 0 |
| swap | 2 | 10 / 1 | 6:30 PM | 0 |
| thanksgiving-8 | 1 | 26 / 2 | 4:00 PM | 0 |

각 시나리오는 스냅샷 비교 뒤에도 진행하여 모든 단계를 명시적으로 완료한다.
연어 지연은 `salmon:1`, `salmon:2`만 바꾸며 나머지 단계는 그대로다.
추수감사절의 주방 현지 시각은 예열 12:21–12:32, 칠면조 굽기 12:32–3:02,
휴지 3:02–3:52, 카빙 3:52–4:00이다. 전환은 3:06–3:09이며,
스터핑 3:09–3:39, 감자 3:22–3:57, 연어 3:39–3:57로 팬 공간을 넘겨 쓴다.

## 바뀐 인터페이스

- `Kitchen.ovens`: 숫자에서 OvenProfile 배열로 변경. MCP `set_kitchen.ovens` 입력은
  숫자를 유지하고 `timezone` 필수, `oven_profiles` 부분 덮어쓰기를 추가했다.
- `temperature` → `temperature_f`, 레시피 `kind`, `oven_units`, servings, hold_max,
  safety/provenance/tags 추가. 시스템 단계는 `dish_id: null`, source로 구분한다.
- Plan은 schema 2, household_id, serve_requested, timestamps, oven_segments, warnings를 갖는다.
- plan_meal의 HH:MM, next_step의 start_step_id, 변경 툴의 request_id와 반복 제어,
  계획 변경의 based_on_version을 사용할 수 있다.
- 응답의 `content`는 읽을 문장이고 전체 JSON은 `structuredContent`에 있다.
  오류도 `isError`와 ToolError를 함께 제공한다.
- timer_suggestions에 label·ends_at, 지연 응답에 changes_summary를 추가했다.
- 가구 쿼리는 household_id로 분리하되 HTTP 서비스는 현재 `local` 고정이다.

## 설계와 달라진 점 / 구체화한 선택

1. 추수감사절 8요리에서 칠면조 휴지 fixture를 **50분**으로 조정하고 배치 우선순위를
   칠면조→연어→감자→스터핑으로 정했다. 오븐 요리들이 칠면조 휴지/카빙 중 들어가며,
   감자·스터핑의 400/375°F·각 2 units 조건을 지킨다. 실측한 값으로 주장하지 않는다.
2. 온도 구간은 오븐이 비지 않는 연속 점유 묶음으로 해석했다. 묶음 중간에 온도를
   바꾸지 않고 전체 범위의 중간값을 유지한다. 전역 최적화는 하지 않는다.
3. v1의 시간대 정보가 없어 마이그레이션 기본값을 데모 시간대인 `America/Chicago`로
   정했다. 누락된 열처리 간격이 있는 미시작 계획은 앞으로 보정하므로 서빙이 늦어질 수 있다.
   물리적으로 모순되는 동결된 과거 일정은 자동 수정하지 않고 마이그레이션 전체를 롤백한다.
4. SDK 기본 입력 검증 오류는 음성 계약과 다르게 나오므로 공개 low-level
   CallToolRequest handler에서 공통 Zod 검증·오류 봉투를 적용했다. SDK private API는 쓰지 않았다.
5. 버전 이력을 복원할 수 있게 설계의 `plan_events.changes` JSON 안에 전체 계획 스냅샷도 넣었다.
   별도 외부 이벤트 전송이나 7단계 UI는 만들지 않았다.
6. minute epoch 모델에 맞춰 ISO 입력은 초가 00인 분 단위 시각을 받는다.
   HH:MM의 DST 공백은 다음 실제로 존재하는 해당 시각, 반복 시각은 다음 미래 occurrence를 선택한다.
7. 기존 `._*` macOS 부가 파일은 건드리지 않고 ignore했다. `data/` ignore는 실행 DB 경로에만
   한정해 소스 JSON이 커밋에서 빠지지 않게 했다.

## 프릭션 로그

`docs/friction/TEMPLATE.md`, `FRICTION_LOG.md`, `entries/` 생성 명령을 시작했다.
설계의 F-01–F-11은 **원문·해당 단계 실험을 다시 확인할 씨앗 목록**으로만 남겼다.
이번 단계에 외부 제품 때문에 15분 이상 막히거나 문서와 실제의 불일치를 확인한 사건은 없었다.
따라서 **새 확정 F 번호는 없다**. 내부 구현 버그나 임시 생성 테스트를 프릭션으로 기록하지 않았다.
실제 신규 사건은 F-12부터 생성하며 증거·소요 시간·심각도·우회책·개선 제안을 채운다.

## 실행 방법

```sh
npm ci
npm run check
npm run dev
# 컴파일된 서버:
npm run build && npm start
# 레시피 검증 / 실제 HTTP smoke:
npm run validate:recipes
npm run smoke
# 실제 외부 제품 이슈가 발생했을 때:
npm run friction:new -- "Issue title"
```
