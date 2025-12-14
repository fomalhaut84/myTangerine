/**
 * Excel 생성 유틸리티
 * Issue #113: 주문 목록 Excel 내보내기
 */

import ExcelJS from 'exceljs';
import type { ExcelTableRow, ExcelOptions } from '@mytangerine/core';

/**
 * Excel Formula Injection 방지를 위한 문자열 새니타이징
 * =, +, -, @, Tab, CR, LF 및 공백/제어문자로 시작하는 값은 수식으로 해석될 수 있음
 * 앞에 작은따옴표(')를 추가하여 텍스트로 강제 처리
 *
 * @param value - 새니타이징할 값
 * @returns 새니타이징된 문자열 또는 원본 값
 */
function sanitizeForExcel(value: string | number): string | number {
  if (typeof value !== 'string') {
    return value;
  }

  // 앞뒤 공백/제어문자 제거 후 검사 (trim 후에도 위험 문자 체크)
  const trimmed = value.trim();

  // 수식으로 해석될 수 있는 위험한 시작 문자 패턴
  // =, +, -, @, Tab(\t), CR(\r), LF(\n), 공백 후 수식 문자
  const dangerousPattern = /^[=+\-@\t\r\n]/;

  if (dangerousPattern.test(trimmed) || dangerousPattern.test(value)) {
    // 작은따옴표를 앞에 추가하여 텍스트로 강제 처리
    return `'${value}`;
  }

  return value;
}

/**
 * 시트 이름 새니타이징
 * Excel에서 허용되지 않는 문자를 제거하고 31자로 제한
 *
 * @param name - 원본 시트 이름
 * @returns 새니타이징된 시트 이름
 */
function sanitizeSheetName(name: string): string {
  // Excel에서 허용되지 않는 문자: : \ / ? * [ ]
  const sanitized = name.replace(/[:\\/?*[\]]/g, '_');
  // 시트 이름은 31자 제한
  return sanitized.slice(0, 31);
}

/**
 * Excel 헤더 정의
 */
const EXCEL_HEADERS = [
  { key: '번호', header: '번호', width: 8 },
  { key: '보내는분_성명', header: '보내는분\n성명', width: 12 },
  { key: '보내는분_전화번호', header: '보내는분\n전화번호', width: 15 },
  { key: '받는분_주소', header: '받는분 주소', width: 40 },
  { key: '받는분_성명', header: '받는분\n성명', width: 12 },
  { key: '받는분_전화번호', header: '받는분\n전화번호', width: 15 },
  { key: '수량', header: '수량', width: 8 },
  { key: '품목명', header: '품목명', width: 12 },
];

/**
 * Excel Buffer 생성
 *
 * @param rows - Excel 테이블 행 데이터
 * @param options - Excel 생성 옵션
 * @returns Excel Buffer를 반환하는 Promise
 */
export async function generateExcelBuffer(
  rows: ExcelTableRow[],
  options: ExcelOptions = {}
): Promise<Buffer> {
  const {
    title = '현애순(딸) 주문목록',
    sheetName = '주문목록',
    includeTimestamp = true,
    filterDescription,
  } = options;

  // 워크북 생성
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'myTangerine';
  workbook.created = new Date();

  // 워크시트 추가 (시트 이름 새니타이징)
  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));

  // 제목 행 추가
  let currentRow = 1;

  // 제목 (새니타이징 적용)
  worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const titleCell = worksheet.getCell(`A${currentRow}`);
  titleCell.value = sanitizeForExcel(title);
  titleCell.font = { size: 18, bold: true };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  currentRow++;

  // 생성 일시
  if (includeTimestamp) {
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const timestampCell = worksheet.getCell(`A${currentRow}`);
    timestampCell.value = `생성 일시: ${new Date().toLocaleString('ko-KR')}`;
    timestampCell.font = { size: 10, color: { argb: 'FF666666' } };
    currentRow++;
  }

  // 필터 설명 (새니타이징 적용)
  if (filterDescription) {
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const filterCell = worksheet.getCell(`A${currentRow}`);
    filterCell.value = sanitizeForExcel(filterDescription);
    filterCell.font = { size: 10, color: { argb: 'FF666666' } };
    currentRow++;
  }

  // 빈 행 추가
  currentRow++;

  // 헤더 행 설정
  const headerRow = worksheet.getRow(currentRow);
  EXCEL_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header.header;
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  });
  headerRow.height = 35;
  currentRow++;

  // 데이터 행 추가 (새니타이징 적용)
  rows.forEach((row) => {
    const dataRow = worksheet.getRow(currentRow);

    EXCEL_HEADERS.forEach((header, index) => {
      const cell = dataRow.getCell(index + 1);
      const rawValue = row[header.key as keyof ExcelTableRow];
      cell.value = sanitizeForExcel(rawValue);

      // 주소 컬럼은 좌측 정렬, 나머지는 중앙 정렬
      const isAddress = header.key === '받는분_주소';
      cell.alignment = {
        horizontal: isAddress ? 'left' : 'center',
        vertical: 'middle',
        wrapText: true,
      };

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      };
    });

    dataRow.height = 25;
    currentRow++;
  });

  // 컬럼 너비 설정
  EXCEL_HEADERS.forEach((header, index) => {
    worksheet.getColumn(index + 1).width = header.width;
  });

  // Buffer로 변환
  const buffer = await workbook.xlsx.writeBuffer();
  // Node.js에서는 Buffer 반환, 브라우저에서는 ArrayBuffer 반환
  // Buffer가 정의되어 있고 이미 Buffer인 경우 그대로 반환
  if (typeof Buffer !== 'undefined' && buffer instanceof Buffer) {
    return buffer;
  }
  return Buffer.from(buffer);
}
