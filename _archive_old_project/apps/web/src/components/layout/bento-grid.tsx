import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export interface BentoCardProps {
  title: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  colSpan?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
}

export const BentoCard: React.FC<BentoCardProps> = ({
  title,
  icon,
  className,
  children,
  colSpan = 1,
  rowSpan = 1,
}) => {
  return (
    <Card 
      className={cn(
        'h-full w-full',
        colSpan === 2 && 'md:col-span-2',
        colSpan === 3 && 'md:col-span-3 lg:col-span-3',
        rowSpan === 2 && 'row-span-2',
        className
      )}
    >
      <CardHeader className="flex flex-row items-center space-x-2 pb-2">
        {icon && <div className="text-accent">{icon}</div>}
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
};

export const BentoGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({ 
  children, 
  className 
}) => {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", className)}>
      {children}
    </div>
  );
};
