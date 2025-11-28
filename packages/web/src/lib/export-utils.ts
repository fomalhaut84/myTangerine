/**
 * CSV/Excel 내보내기 유틸리티
 */

import * as XLSX from 'xlsx';
import type { Order } from '@/types/api';

/**
 * 주문 데이터를 CSV 형식으로 변환
 */
function ordersToCSV(orders: Order[]): string {
  // CSV 헤더
  const headers = [
    '주문번호',
    '주문일시',
    '상태',
    '보내는 사람',
    '보내는 사람 전화번호',
    '보내는 사람 주소',
    '받는 사람',
    '받는 사람 전화번호',
    '받는 사람 주소',
    '상품',
    '수량',
  ];

  // CSV 행
  const rows = orders.map((order) => [
    order.rowNumber.toString(),
    order.timestamp,
    order.status || '미확인',
    order.sender.name,
    order.sender.phone,
    order.sender.address,
    order.recipient.name,
    order.recipient.phone,
    order.recipient.address,
    order.validationError ? `[오류] ${order.validationError}` : (order.productType || '알 수 없음'),
    order.quantity.toString(),
  ]);

  // CSV 문자열 생성
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row.map((cell) => {
        // 쉼표나 따옴표가 포함된 경우 따옴표로 감싸기
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(',')
    ),
  ].join('\n');

  // UTF-8 BOM 추가 (Excel에서 한글 깨짐 방지)
  return '\uFEFF' + csvContent;
}

/**
 * CSV 파일 다운로드
 */
export function downloadCSV(orders: Order[], filename: string = 'orders.csv') {
  const csvContent = ordersToCSV(orders);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Excel 파일 다운로드
 */
export function downloadExcel(orders: Order[], filename: string = 'orders.xlsx') {
  // 워크시트 데이터 생성
  const data = [
    // 헤더
    [
      '주문번호',
      '주문일시',
      '상태',
      '보내는 사람',
      '보내는 사람 전화번호',
      '보내는 사람 주소',
      '받는 사람',
      '받는 사람 전화번호',
      '받는 사람 주소',
      '상품',
      '수량',
    ],
    // 데이터 행
    ...orders.map((order) => [
      order.rowNumber,
      order.timestamp,
      order.status || '미확인',
      order.sender.name,
      order.sender.phone,
      order.sender.address,
      order.recipient.name,
      order.recipient.phone,
      order.recipient.address,
      order.validationError ? `[오류] ${order.validationError}` : (order.productType || '알 수 없음'),
      order.quantity,
    ]),
  ];

  // 워크시트 생성
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // 열 너비 설정
  worksheet['!cols'] = [
    { wch: 10 },  // 주문번호
    { wch: 20 },  // 주문일시
    { wch: 10 },  // 상태
    { wch: 15 },  // 보내는 사람
    { wch: 15 },  // 보내는 사람 전화번호
    { wch: 30 },  // 보내는 사람 주소
    { wch: 15 },  // 받는 사람
    { wch: 15 },  // 받는 사람 전화번호
    { wch: 30 },  // 받는 사람 주소
    { wch: 10 },  // 상품
    { wch: 10 },  // 수량
  ];

  // 워크북 생성
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '주문 목록');

  // 파일 다운로드
  XLSX.writeFile(workbook, filename);
}

/**
 * 현재 날짜를 파일명 형식으로 반환
 */
export function getExportFilename(prefix: string = 'orders', extension: string = 'csv'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${prefix}_${year}${month}${day}_${hours}${minutes}.${extension}`;
}
