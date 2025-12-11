/**
 * CSV/Excel 내보내기 유틸리티
 */

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
  // 서버 컴포넌트 안전성 가드
  if (typeof window === 'undefined') {
    console.warn('downloadCSV는 클라이언트 환경에서만 사용 가능합니다.');
    return;
  }

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
export async function downloadExcel(orders: Order[], filename: string = 'orders.xlsx') {
  // 서버 컴포넌트 안전성 가드
  if (typeof window === 'undefined') {
    console.warn('downloadExcel은 클라이언트 환경에서만 사용 가능합니다.');
    return;
  }

  // Lazy import로 번들 사이즈 최적화 (ExcelJS는 수백 KB)
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ]);

  // 워크북 생성
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('주문 목록');

  // 열 정의 (헤더 + 너비)
  worksheet.columns = [
    { header: '주문번호', key: 'rowNumber', width: 10 },
    { header: '주문일시', key: 'timestamp', width: 20 },
    { header: '상태', key: 'status', width: 10 },
    { header: '보내는 사람', key: 'senderName', width: 15 },
    { header: '보내는 사람 전화번호', key: 'senderPhone', width: 15 },
    { header: '보내는 사람 주소', key: 'senderAddress', width: 30 },
    { header: '받는 사람', key: 'recipientName', width: 15 },
    { header: '받는 사람 전화번호', key: 'recipientPhone', width: 15 },
    { header: '받는 사람 주소', key: 'recipientAddress', width: 30 },
    { header: '상품', key: 'productType', width: 10 },
    { header: '수량', key: 'quantity', width: 10 },
  ];

  // 데이터 행 추가
  orders.forEach((order) => {
    worksheet.addRow({
      rowNumber: order.rowNumber,
      timestamp: order.timestamp,
      status: order.status || '미확인',
      senderName: order.sender.name,
      senderPhone: order.sender.phone,
      senderAddress: order.sender.address,
      recipientName: order.recipient.name,
      recipientPhone: order.recipient.phone,
      recipientAddress: order.recipient.address,
      productType: order.validationError ? `[오류] ${order.validationError}` : (order.productType || '알 수 없음'),
      quantity: order.quantity,
    });
  });

  // 버퍼로 내보내기
  const buffer = await workbook.xlsx.writeBuffer();

  // Blob 생성 및 다운로드
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, filename);
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
