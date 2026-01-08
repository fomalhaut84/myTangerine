/**
 * 공통 카드 컴포넌트
 * shadcn/ui Card를 사용하여 재구현
 */

import type { ReactNode } from 'react';
import {
  Card as ShadcnCard,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className }: CardProps) {
  return (
    <ShadcnCard className={cn(className)}>
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(!title && 'pt-6')}>
        {children}
      </CardContent>
    </ShadcnCard>
  );
}
