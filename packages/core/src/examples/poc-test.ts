/**
 * Google Sheets API PoC 테스트 스크립트
 *
 * 사용법:
 * 1. .env 파일에 필요한 환경 변수 설정
 * 2. pnpm install 실행
 * 3. pnpm tsx src/examples/poc-test.ts 실행
 */

import { Config } from '../config/config.js';
import { SheetService } from '../services/sheet-service.js';

async function main() {
  console.log('🍊 Google Sheets API PoC 테스트 시작\n');

  try {
    // 1. 설정 로드
    console.log('1. 설정 로드 중...');
    const config = new Config();
    console.log(`✅ 스프레드시트: ${config.spreadsheetName}`);
    console.log(`✅ 기본 발송인: ${config.defaultSender.name}\n`);

    // 2. SheetService 초기화
    console.log('2. Google Sheets 서비스 초기화 중...');
    const sheetService = new SheetService(config);
    console.log('✅ 서비스 초기화 완료\n');

    // 3. 모든 행 가져오기
    console.log('3. 스프레드시트 데이터 조회 중...');
    const allRows = await sheetService.getAllRows();
    console.log(`✅ 총 ${allRows.length}개 행 조회 완료\n`);

    if (allRows.length > 0) {
      console.log('첫 번째 행 샘플:');
      console.log(JSON.stringify(allRows[0], null, 2));
      console.log('');
    }

    // 4. 새 주문만 가져오기
    console.log('4. 새 주문 조회 중...');
    const newOrders = await sheetService.getNewOrders();
    console.log(`✅ 새 주문 ${newOrders.length}개 발견\n`);

    if (newOrders.length > 0) {
      console.log('새 주문 목록:');
      newOrders.forEach((order, index) => {
        console.log(`  ${index + 1}. ${order['받으실분 성함']} - ${order['상품 선택']}`);
      });
      console.log('');
    }

    console.log('🎉 PoC 테스트 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    process.exit(1);
  }
}

main();
