/**
 * 최초 입력값 (#281 — hybrid DB 우선)
 * 주문자가 폼에 처음 입력한 값. 웹 수정과 무관하게 보존된다. 이 기능 이전 주문은 보관된 값이 없다.
 */

'use client';

import { useState } from 'react';

interface OriginalInputSectionProps {
  originalInput?: Record<string, string>;
}

export function OriginalInputSection({ originalInput }: OriginalInputSectionProps) {
  const [open, setOpen] = useState(false);

  if (!originalInput) {
    return (
      <p className="text-sm text-gray-500">
        보관된 최초 입력값이 없습니다 (최초 입력값 보관 기능 이전에 들어온 주문).
      </p>
    );
  }

  const entries = Object.entries(originalInput);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-sm font-medium text-gray-700 hover:text-gray-900"
      >
        {open ? '▾' : '▸'} 최초 입력값 (주문자가 폼에 입력한 원본 · {entries.length}칸)
      </button>
      {open && (
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          {entries.map(([column, value]) => (
            <div key={column} className="contents">
              <dt className="text-gray-500 break-keep">{column}</dt>
              <dd className="sm:col-span-2 text-gray-900 break-all">
                {value === '' ? <span className="text-gray-400">(비어 있음)</span> : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
