/**
 * PDF 생성 유틸리티
 * Issue #98: 주문 목록 PDF 내보내기
 */

import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PdfTableRow, PdfOptions } from '@mytangerine/core';
import { findProjectRoot } from '@mytangerine/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 폰트 경로 계산 (프로덕션 빌드 대응)
 * 프로젝트 루트를 기준으로 절대 경로 계산
 */
function getFontsPath(): string {
  const projectRoot = findProjectRoot(__dirname);
  const fontsPath = join(projectRoot, 'packages/api/assets/fonts');

  // 런타임 검증: 폰트 디렉토리가 존재하는지 확인
  if (!existsSync(fontsPath)) {
    throw new Error(
      `Fonts directory not found: ${fontsPath}\n` +
        `Project root: ${projectRoot}\n` +
        `Current directory: ${__dirname}`
    );
  }

  return fontsPath;
}

/**
 * 폰트 정의
 */
const fontsPath = getFontsPath();
const fonts: TFontDictionary = {
  NanumGothicCoding: {
    normal: join(fontsPath, 'NanumGothicCoding-Regular.ttf'),
    bold: join(fontsPath, 'NanumGothicCoding-Bold.ttf'),
    italics: join(fontsPath, 'NanumGothicCoding-Regular.ttf'),
    bolditalics: join(fontsPath, 'NanumGothicCoding-Bold.ttf'),
  },
};

/**
 * PDF Document Definition 생성
 *
 * @param rows - PDF 테이블 행 데이터
 * @param options - PDF 생성 옵션
 * @returns pdfmake Document Definition
 */
export function createPdfDocumentDefinition(
  rows: PdfTableRow[],
  options: PdfOptions = {}
): TDocumentDefinitions {
  const {
    title = '현애순(딸) 주문목록',
    includeTimestamp = true,
    filterDescription,
    pageOrientation = 'landscape',
    pageSize = 'A4',
  } = options;

  // 헤더 행 (줄바꿈 추가, 수직 중앙 정렬)
  const headerRow = [
    { text: '번호', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '보내는분\n성명', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '보내는분\n전화번호', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '받는분 주소', style: 'tableHeader', alignment: 'left', margin: [0, 0, 0, 0] },
    { text: '받는분\n성명', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '받는분\n전화번호', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '수량', style: 'tableHeader', margin: [0, 0, 0, 0] },
    { text: '품목명', style: 'tableHeader', margin: [0, 0, 0, 0] },
  ];

  // 데이터 행 (수직 중앙 정렬)
  const dataRows = rows.map((row) => [
    { text: row.번호.toString(), style: 'tableCell', margin: [0, 0, 0, 0] },
    { text: row.보내는분_성명, style: 'tableCell', margin: [0, 0, 0, 0] },
    { text: row.보내는분_전화번호, style: 'tableCell', margin: [0, 0, 0, 0] },
    {
      text: row.받는분_주소,
      style: 'tableCellAddress',
      alignment: 'left',
      margin: [0, 0, 0, 0],
      noWrap: false, // 공백 기준 줄바꿈 활성화
    },
    { text: row.받는분_성명, style: 'tableCell', margin: [0, 0, 0, 0] },
    { text: row.받는분_전화번호, style: 'tableCell', margin: [0, 0, 0, 0] },
    { text: row.수량.toString(), style: 'tableCell', margin: [0, 0, 0, 0] },
    { text: row.품목명, style: 'tableCell', margin: [0, 0, 0, 0] },
  ]);

  // 문서 헤더
  const documentHeader: any[] = [
    { text: title, style: 'header' },
  ];

  if (includeTimestamp) {
    documentHeader.push({
      text: `생성 일시: ${new Date().toLocaleString('ko-KR')}`,
      style: 'subheader',
    });
  }

  if (filterDescription) {
    documentHeader.push({
      text: filterDescription,
      style: 'subheader',
    });
  }

  // Document Definition
  const docDefinition: TDocumentDefinitions = {
    pageSize,
    pageOrientation,
    pageMargins: [15, 20, 15, 20], // 좌, 상, 우, 하
    defaultStyle: {
      font: 'NanumGothicCoding',
    },
    content: [
      ...documentHeader,
      {
        margin: [0, 15, 0, 0], // 테이블 상단 마진 15
        table: {
          headerRows: 1,
          widths: [
            25,   // 번호
            50,   // 보내는분 성명
            65,   // 보내는분 전화번호
            '*',  // 받는분 주소 (가변, 최대 공간 확보)
            50,   // 받는분 성명
            65,   // 받는분 전화번호
            35,   // 수량
            50,   // 품목명
          ],
          body: [headerRow, ...dataRows],
        },
        layout: {
          fillColor: (rowIndex: number) => {
            return rowIndex === 0 ? '#F2F2F2' : null;
          },
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#CCCCCC',
          vLineColor: () => '#CCCCCC',
          // 셀 안쪽 여백 (좌, 상, 우, 하 모두 10)
          paddingLeft: () => 10,
          paddingRight: () => 10,
          paddingTop: () => 10,
          paddingBottom: () => 10,
        },
      },
    ],
    styles: {
      header: {
        fontSize: 18,
        bold: true,
        margin: [0, 0, 0, 10],
        // 좌측 정렬 (기본값)
      },
      subheader: {
        fontSize: 10,
        margin: [0, 0, 0, 5],
        color: '#666666',
        // 좌측 정렬 (기본값)
      },
      tableHeader: {
        bold: true,
        fontSize: 11,
        color: 'black',
        fillColor: '#F2F2F2',
        alignment: 'center', // 수평 중앙 정렬
        lineHeight: 1.5,
        // 수직 중앙 정렬은 padding과 margin으로 구현
      },
      tableCell: {
        fontSize: 10,
        alignment: 'center', // 수평 중앙 정렬
        lineHeight: 1.5,
        // 수직 중앙 정렬은 padding과 margin으로 구현
      },
      tableCellAddress: {
        fontSize: 9, // 주소는 폰트 크기를 작게
        alignment: 'left', // 주소는 좌측 정렬
        lineHeight: 1.4,
        // 공백 기준 줄바꿈 (noWrap: false)
      },
    },
    footer: (currentPage: number, pageCount: number) => {
      return {
        text: `${currentPage} / ${pageCount}`,
        alignment: 'center',
        fontSize: 9,
        margin: [0, 10, 0, 0],
      };
    },
  };

  return docDefinition;
}

/**
 * PDF Buffer 생성
 *
 * @param rows - PDF 테이블 행 데이터
 * @param options - PDF 생성 옵션
 * @returns PDF Buffer를 반환하는 Promise
 */
export function generatePdfBuffer(
  rows: PdfTableRow[],
  options: PdfOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const docDefinition = createPdfDocumentDefinition(rows, options);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      const chunks: Buffer[] = [];

      pdfDoc.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      pdfDoc.on('end', () => {
        const result = Buffer.concat(chunks);
        resolve(result);
      });

      pdfDoc.on('error', (error: Error) => {
        reject(error);
      });

      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });
}
