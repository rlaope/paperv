# 논문 학습 데스크톱 앱 — 명확화된 제품 브리프

> **Status: Historical product vision, not the implemented release contract.** This document preserves the long-term discovery brief. Features such as PDF import/viewing, paper Q&A, related-paper discovery, knowledge profiling, and learning roadmaps are aspirational unless the current README and accepted ADRs explicitly say otherwise. The canonical implemented architecture is [ADR 0009](adr/0009-study-and-vault.md), with current release boundaries in the [README](../README.md).

> **Implemented interaction clarification:** The current Study experience is a dense Claude-like natural-request composer, not the task/source/output-language form imagined during discovery. A compact Agent control exposes generation-capable Claude Code and disabled discovery-only Codex CLI; a compact Context control chooses the stored abstract, a saved document, or an exact captured selection. One request selects exactly one closed study skill and English or Korean. It cannot dispatch arbitrary tools or shell work, and its text is ephemeral rather than stored. The current Vault is editor-first: a native textarea and inline breadcrumb/name input, with no document Edit/Preview mode or always-visible formatting/status/revision/word-count chrome. These implemented constraints supersede contrary details below while preserving this brief as historical context.

## 목표

공부하는 엔지니어와 대학생이 PDF 파일이나 arXiv URL로 논문을 가져오면, 사용자의 요청과 현재 지식 수준에 맞춰 다음 작업을 하나의 데스크톱 앱에서 수행할 수 있게 한다.

- 논문 전체를 쉬운 글로 재구성
- 논문 내용에 관한 질의응답
- arXiv 기반 연관 논문 탐색
- 현재 문제와 학습 목적에 맞는 다음 학습 로드맵 제안
- 특정 분야에서 강점을 만들기 위해 필요한 개념과 논문 안내

핵심 결과물은 단순한 짧은 요약이 아니라, 중학생도 흐름을 이해할 수 있으면서 전문 용어와 논리의 정확성을 유지하는 ‘개념서·모범 교재형 해설’이다.

## 핵심 사용자

- 새로운 분야나 논문을 공부하는 엔지니어
- 전공 및 연구 목적으로 논문을 읽는 대학생

## 제품 형태와 제약

- 첫 출시는 데스크톱 앱으로만 제공한다.
- 논문 입력은 PDF 드래그 앤드 드롭과 URL 입력을 모두 지원한다.
- arXiv 논문 검색과 연관 논문 탐색을 지원한다.
- 중앙 작업 영역에서는 마크다운 노트·편집기와 원문 PDF 미리보기를 함께 사용할 수 있어야 한다.
- 쉬운 표현을 사용하되 핵심 전문 용어, 전제, 인과관계와 논문의 한계를 임의로 제거하지 않는다.
- 기계적인 AI 문체, 상투적인 도입·결론, 불필요한 반복을 피한다.

## 사용자 지식 수준 처리

두 방식을 함께 제공한다.

1. 사용자가 이미 아는 개념과 모르는 개념을 직접 체크한다.
2. 약 세 개의 간단한 진단 질문으로 AI가 이해 수준을 보완해서 추정한다.

생성된 해설은 이 지식 프로필을 사용한다. 이미 안다고 표시한 개념은 매번 처음부터 반복 설명하지 않고, 필요한 경우 짧게 연결만 한다. 모르는 개념은 현재 논문을 이해하는 데 필요한 깊이까지 단계적으로 설명한다.

## 성공 기준

실제 논문 한 편을 넣었을 때 다음 조건을 만족하면 첫 버전의 핵심 경험이 성공한 것으로 본다.

- 논문 전체의 문제의식, 전제, 방법, 결과, 한계가 빠지지 않고 연결된 글로 재구성된다.
- 중학생도 문장과 비유를 따라갈 수 있지만, 전문 용어와 기술적 의미가 왜곡되지 않는다.
- 독자가 아는 개념과 모르는 개념을 구분하여 설명 깊이가 달라진다.
- 이미 아는 개념의 장황한 반복 설명이 없다.
- 결과물이 AI 요약문이 아니라 사람이 다듬은 개념서나 모범 교재처럼 읽힌다.
- 사용자는 해설에서 원문의 근거 위치로 이동하거나 원문과 대조할 수 있다.
- 후속 질문, 연관 논문 탐색, 다음 학습 로드맵이 현재 논문과 사용자의 학습 목적에 연결된다.

## 비목표

첫 출시에서는 다음을 핵심 범위에 포함하지 않는다.

- 웹앱 또는 모바일 앱 제공
- 논문을 지나치게 단순화하여 기술적 정확성을 희생하는 요약
- 사용자의 지식 수준을 무시한 모든 사용자 대상의 동일한 설명
- 근거 없이 진로·전문성 향상 경로를 단정하는 조언
- PDF 뷰어, 노트 편집기, 챗봇이 서로 분리된 단순 도구 모음

## 결정 경계

- 쉬움과 정확성이 충돌하면 전문적 정확성을 보존하고, 용어 풀이·비유·단계적 설명으로 난도를 낮춘다.
- 사용자가 이미 안다고 밝힌 개념은 생략하되, 논문의 새로운 사용법이나 변형이 핵심이면 차이만 설명한다.
- 로드맵은 현재 해결 중인 문제, 목표 분야, 이미 아는 개념을 근거로 제시하며 근거가 부족하면 먼저 확인한다.

## 다음 기획 경로

다음 단계에서는 이 브리프를 기준으로 데스크톱 앱의 핵심 사용자 흐름, 화면 구조, 지식 프로필 모델, 논문 처리 파이프라인, 근거 연결 방식과 품질 평가 기준을 설계한다. 이후 기능을 구현 순서와 검증 가능한 마일스톤으로 나눈다.
