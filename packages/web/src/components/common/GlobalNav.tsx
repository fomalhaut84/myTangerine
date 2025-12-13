/**
 * 글로벌 네비게이션 바
 * 주요 페이지 간 이동을 위한 상단 메뉴
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, BarChart3, Package, Tag } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: '대시보드',
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    href: '/stats',
    label: '통계',
    icon: <BarChart3 className="h-4 w-4" />,
  },
  {
    href: '/orders',
    label: '주문관리',
    icon: <Package className="h-4 w-4" />,
  },
  {
    href: '/labels',
    label: '라벨',
    icon: <Tag className="h-4 w-4" />,
  },
];

export function GlobalNav() {
  const pathname = usePathname();

  // 홈페이지('/')에서는 GNB를 숨김
  if (pathname === '/') {
    return null;
  }

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* 로고 */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-orange-600 font-bold text-lg"
          >
            <span className="text-2xl">🍊</span>
            <span className="hidden sm:inline">myTangerine</span>
          </Link>

          {/* 메뉴 */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                    transition-colors duration-200
                    ${isActive
                      ? 'bg-orange-100 text-orange-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.icon}
                  <span className="hidden sm:inline" aria-hidden="true">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
