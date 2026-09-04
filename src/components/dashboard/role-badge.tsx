"use client";
import { Badge } from "@/components/ui/badge";
import { ROLE_META, type Role } from "@/lib/eco";

export function RoleBadge({ role, className = "" }: { role: Role; className?: string }) {
  const meta = ROLE_META[role];
  return (
    <Badge variant="outline" className={`${meta.className} ${className}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot} mr-1.5`} />
      {meta.label}
    </Badge>
  );
}
