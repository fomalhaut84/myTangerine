-- Issue #281: 최초 입력값 보관 (hybrid DB 우선)
-- 추가만 한다 — 기존 행은 NULL 로 둔다(원본을 확실히 알 수 없어 채우지 않는다)

ALTER TABLE "orders" ADD COLUMN "original_input" JSONB;
