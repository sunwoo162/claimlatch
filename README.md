# ClaimLatch

**LLM 답변을 위한 근거 기반 릴리스 게이트.**

LLM은 사용자가 기대하는 확신 수준에 도달하기 전에 유창한 답변을 만들어낼 수 있습니다. ClaimLatch는 생성과 전달 사이에 위치해 사실 주장을 추출하고, 근거를 수집하고, 각 주장을 구체적인 근거에 연결해 검증한 뒤, 정책에 따라 초안을 결정적으로 **PASS**하거나 **BLOCK**합니다.

> ClaimLatch는 모델에게 "얼마나 자신 있나요?"라고 묻고 그 자기 보고를 신뢰도 점수로 바꾸지 않습니다.

## 처리 파이프라인

```text
사용자 질문
    ↓
LLM 초안 답변
    ↓
ClaimExtractor
    ↓
EvidenceProvider
    ↓
선택적 문서 provenance 보강
    ↓
ClaimVerifier
    ↓
핵심 불변식 검증기
    ↓
결정적 정책 게이트
    ↓
PASS / BLOCK
```

각 사실 주장은 다음 상태 중 정확히 하나로 끝납니다.

- `SUPPORTED`
- `CONTRADICTED`
- `UNSUPPORTED`
- `UNVERIFIABLE`

`coverage`는 충분한 근거를 바탕으로 supported/contradicted 판정을 내릴 수 있었던 주장의 비율입니다. 정확도 퍼센트가 아닙니다.

## 설치 및 빌드

```bash
npm install
npm run build
npm test
```

Node.js 20 이상을 지원합니다. PDF 문서 추출을 위해 PDF.js 런타임 의존성을 사용하며, TypeScript는 개발 의존성으로만 사용합니다.

## CLI

OpenAI 호환 검증 모델과 Tavily 검색을 설정합니다.

```bash
export CLAIMLATCH_LLM_API_KEY="..."
export CLAIMLATCH_LLM_MODEL="your-model"
# 선택 사항: export CLAIMLATCH_LLM_BASE_URL="https://your-endpoint/v1"
export TAVILY_API_KEY="..."
```

사용자에게 전달하기 전에 초안 답변을 검증합니다.

```bash
claimlatch \
  --question "현재 지원되는 버전은 무엇인가요?" \
  --answer "버전 4가 현재 LTS 릴리스입니다."
```

기본적으로 검색 결과는 원본 웹 페이지에서 가능한 한 보강됩니다. 보고서에는 선택된 근거가 `search-snippet`인지 `retrieved-document` 인용문인지 기록됩니다.

엄격한 provenance 모드는 검색 스니펫만으로 결정적인 판정을 내리는 것을 거부합니다.

```bash
claimlatch \
  -q "..." \
  -a "..." \
  --require-document-provenance
```

차단된 보고서는 종료 코드 `1`, 사용량 또는 provider 오류는 종료 코드 `2`를 반환합니다.

기계가 읽을 수 있는 형식으로 출력하려면 다음을 사용합니다.

```bash
claimlatch -q "..." -a "..." --json
```

## OpenAI 호환 reverse proxy

`claimlatch-proxy`는 OpenAI Chat Completions 호환 provider 앞에 배치할 수 있습니다. 생성된 답변을 버퍼링하고 검증한 뒤 PASS일 때만 upstream completion을 전달합니다.

```bash
export CLAIMLATCH_PROXY_UPSTREAM_BASE_URL="https://api.openai.com/v1"
export CLAIMLATCH_PROXY_UPSTREAM_API_KEY="..."

export CLAIMLATCH_LLM_API_KEY="..."
export CLAIMLATCH_LLM_MODEL="your-verifier-model"
export TAVILY_API_KEY="..."

claimlatch-proxy
```

기존 클라이언트의 endpoint를 다음 주소로 지정합니다.

```text
http://127.0.0.1:4317/v1
```

동작 방식:

- PASS: 원래 upstream Chat Completions JSON을 `x-claimlatch-result: pass` 헤더와 함께 반환합니다.
- BLOCK: `error.code = "claimlatch_blocked"`와 검증 보고서를 포함한 HTTP `422`를 반환합니다.
- `stream: true`: 아직 거부됩니다. 검증 전에 토큰을 내보내면 게이트를 우회하게 됩니다.
- `/health`: 가벼운 로컬 health endpoint입니다.

proxy용 upstream API 키를 설정하지 않으면 들어온 `Authorization` 헤더를 upstream provider로 전달합니다. proxy는 기본적으로 `127.0.0.1`에 바인딩됩니다.

ClaimLatch proxy 자체를 `CLAIMLATCH_LLM_BASE_URL`로 지정하지 마세요. 게이트를 재귀적으로 통과하지 않는 검증 endpoint를 사용해야 합니다.

선택적 proxy 설정:

```bash
export CLAIMLATCH_PROXY_HOST="127.0.0.1"
export CLAIMLATCH_PROXY_PORT="4317"
export CLAIMLATCH_REQUIRE_DOCUMENT_PROVENANCE="1"
```

V0.2 proxy의 범위는 의도적으로 작습니다. Chat Completions, 텍스트 형식의 user/assistant content, non-streaming만 지원합니다.

## SDK

```ts
import {
  ClaimLatch,
  LlmClaimExtractor,
  LlmClaimVerifier,
  OpenAICompatibleClient,
  ProvenanceEvidenceProvider,
  TavilyEvidenceProvider,
} from "claimlatch";

const llm = new OpenAICompatibleClient({
  apiKey: process.env.CLAIMLATCH_LLM_API_KEY,
  model: process.env.CLAIMLATCH_LLM_MODEL!,
});

const search = new TavilyEvidenceProvider({
  apiKey: process.env.TAVILY_API_KEY!,
  primaryDomains: ["docs.example.com"],
});

const gate = new ClaimLatch({
  extractor: new LlmClaimExtractor(llm),
  evidenceProvider: new ProvenanceEvidenceProvider({ provider: search }),
  verifier: new LlmClaimVerifier(llm),
});

const report = await gate.verify({
  question,
  answer: draft,
  policy: {
    minimumCoverage: 1,
    maxUnsupportedClaims: 0,
    maxUnverifiableClaims: 0,
    blockOnContradiction: true,
    requireRetrievedDocumentForDecisiveClaims: true,
  },
});

if (!report.passed) {
  // 검증된 답변으로 초안을 전달하지 않습니다.
}
```

모든 extraction/search/verification 구성 요소는 인터페이스로 정의되어 있습니다. 따라서 기본 adapter 대신 로컬 모델, private corpus, 공식 API, 커스텀 RAG 시스템을 연결할 수 있습니다.

## Evidence provenance

문서 보강에 성공하면 ClaimLatch는 다음 정보를 저장합니다.

- 검증된 redirect 이후의 최종 source URL
- verifier에 전달된 정확한 인용문
- 정규화된 source text의 인용문 문자 offset
- PDF인 경우 페이지 번호와 해당 페이지 기준 quote offset
- retrieval 시각과 content type
- 정규화된 retrieved document의 SHA-256

이를 통해 판정을 감사할 수 있습니다. 다만 publisher가 올바르다는 사실이나 HTML 추출이 모든 맥락을 보존했다는 사실을 증명하지는 않습니다.

기본 제공 fetcher는 흔한 localhost/private-network 대상을 차단하고, 요청 전에 DNS 주소를 확인합니다. DNS 결과에 공용 주소가 아닌 주소가 하나라도 포함되면 fail-closed하며, 선택한 공용 IP로 연결을 고정합니다. redirect도 다시 검증하고, 응답 크기와 timeout을 제한합니다. 커스텀 fetch/request transport를 제공하는 경우에는 동일한 보호를 직접 유지해야 합니다. 남아 있는 네트워크 위험은 `docs/TRUST_MODEL.md`와 `SECURITY.md`를 참고하세요.

`application/pdf` 문서는 PDF.js로 페이지별 텍스트를 추출합니다. 인용문은 가장 관련성이 높은 페이지에 연결되고, 페이지 번호와 페이지 내부 offset이 provenance에 기록됩니다. PDF 파싱이나 텍스트 추출에 실패하면 문서는 결정적 근거로 사용되지 않고 search-snippet provenance로 fallback합니다.

## 기본 게이트 정책

기본 정책은 의도적으로 엄격합니다.

- 모든 contradiction을 차단합니다.
- 서로 다른 source가 같은 claim을 지지하고 반박하면 교차 출처 contradiction으로 차단합니다.
- unsupported claim을 허용하지 않습니다.
- unverifiable claim을 허용하지 않습니다.
- evidence coverage 100%를 요구합니다.
- 모든 critical claim이 `SUPPORTED`여야 합니다.
- 검증 가능한 주장이 0개 추출되면 fail-closed합니다.

문서 수준 provenance는 추가적인 엄격 정책으로 사용할 수 있습니다. 다만 일부 정상적인 source는 안정적으로 가져오지 못할 수 있으므로 기본값으로 활성화하지 않습니다.

커스텀 provider가 반환한 뒤에도 핵심 불변식을 다시 검사합니다. 중복 claim ID를 거부하고, 존재하지 않는 evidence binding을 제거하며, 유효한 evidence binding이 없는 결정적 판정은 `UNVERIFIABLE`로 낮춥니다.

## 독립 라벨 benchmark seed

`benchmarks/independent.jsonl`에는 공개 라벨 source URL과 함께 사람이 작성한 positive/negative 답변 쌍이 들어 있습니다. 라벨은 ClaimLatch 출력으로 생성되지 않습니다.

설정된 live provider를 사용해 실행합니다.

```bash
claimlatch-bench --dataset benchmarks/independent.jsonl
# 또는
npm run bench
```

보고되는 지표:

- 데이터셋 라벨과 비교한 decision accuracy
- **false-pass rate**: 잘못된 답변이 게이트를 통과한 비율
- false-block rate: 정답으로 라벨링된 답변을 게이트가 거부한 비율

포함된 seed는 의도적으로 작으며 publication-quality 평가가 아닙니다. 손으로 만든 작은 fixture가 보편적인 benchmark인 것처럼 가장하지 않고, regression을 측정하기 위한 목적입니다.

## Confidence score를 사용하지 않는 이유

`87% trustworthy` 같은 가짜 배지는 ClaimLatch가 해결하려는 문제를 그대로 재현합니다. ClaimLatch는 관찰 가능한 상태를 보고합니다. 어떤 주장이 발견되었는지, 어떤 근거가 수집되었는지, 어떤 관계로 판정되었는지, 어떤 결정적 규칙이 답변을 차단했는지를 보여줍니다.

앞으로 확률 점수를 추가한다면 독립 라벨 데이터로 보정하고, 모델의 자기 확신이 아니라 측정된 동작을 설명해야 합니다.

## Offline demo

offline demo는 네트워크나 모델 호출 없이 결정적인 fake provider로 게이트 동작을 보여줍니다.

```bash
npm run demo
```

이는 배관 연결을 보여주는 demo이지 factuality benchmark가 아닙니다.

## Trust boundary

PASS는 보편적인 진실의 증명이 아닙니다. claim extraction, search, source selection, document parsing, entailment는 모두 실패할 수 있습니다. 고위험 의사결정에 사용하기 전에 [docs/TRUST_MODEL.md](docs/TRUST_MODEL.md)를 읽으세요.

## 프로젝트 상태

`0.2.0`은 quote-level web provenance, 핵심 provider 불변식 강제, OpenAI 호환 proxy, 독립 라벨 benchmark runner를 추가합니다. `1.0` 전에는 공개 API와 provider 동작이 변경될 수 있습니다.

## 라이선스

Apache-2.0
