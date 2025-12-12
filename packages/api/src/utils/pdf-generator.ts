/**
 * PDF 생성 유틸리티
 * Issue #98: 주문 목록 PDF 내보내기
 */

import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PdfTableRow, PdfOptions } from '@mytangerine/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 폰트 정의
 */
const fonts: TFontDictionary = {
  NanumGothicCoding: {
    normal: join(__dirname, '../../assets/fonts/NanumGothicCoding-Regular.ttf'),
    bold: join(__dirname, '../../assets/fonts/NanumGothicCoding-Bold.ttf'),
    italics: join(__dirname, '../../assets/fonts/NanumGothicCoding-Regular.ttf'),
    bolditalics: join(__dirname, '../../assets/fonts/NanumGothicCoding-Bold.ttf'),
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
    title = '주문 목록 보고서',
    includeTimestamp = true,
    filterDescription,
    pageOrientation = 'landscape',
    pageSize = 'A4',
  } = options;

  // 헤더 행
  const headerRow = [
    { text: '번호', style: 'tableHeader' },
    { text: '보내는분 성명', style: 'tableHeader' },
    { text: '보내는분 전화번호', style: 'tableHeader' },
    { text: '받는분 주소', style: 'tableHeader' },
    { text: '받는분 성명', style: 'tableHeader' },
    { text: '받는분 전화번호', style: 'tableHeader' },
    { text: '수량', style: 'tableHeader' },
    { text: '품목명', style: 'tableHeader' },
  ];

  // 데이터 행
  const dataRows = rows.map((row) => [
    { text: row.번호.toString(), style: 'tableCell' },
    { text: row.보내는분_성명, style: 'tableCell' },
    { text: row.보내는분_전화번호, style: 'tableCell' },
    { text: row.받는분_주소, style: 'tableCell' },
    { text: row.받는분_성명, style: 'tableCell' },
    { text: row.받는분_전화번호, style: 'tableCell' },
    { text: row.수량.toString(), style: 'tableCell', alignment: 'center' },
    { text: row.품목명, style: 'tableCell', alignment: 'center' },
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
        table: {
          headerRows: 1,
          widths: [
            30,   // 번호
            60,   // 보내는분 성명
            70,   // 보내는분 전화번호
            '*',  // 받는분 주소 (가변)
            60,   // 받는분 성명
            70,   // 받는분 전화번호
            40,   // 수량
            60,   // 품목명
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
        },
      },
    ],
    styles: {
      header: {
        fontSize: 18,
        bold: true,
        margin: [0, 0, 0, 10],
      },
      subheader: {
        fontSize: 10,
        margin: [0, 0, 0, 5],
        color: '#666666',
      },
      tableHeader: {
        bold: true,
        fontSize: 11,
        color: 'black',
        fillColor: '#F2F2F2',
        alignment: 'center',
      },
      tableCell: {
        fontSize: 10,
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
