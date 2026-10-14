"use client";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { FamilyMember } from "@/lib/types";
import { SkeletonCard } from "@/components/ui";
import { FamilyMemberCard } from "./family-member-card";

/**
 * "Who is this medicine for?" One tap on a person. Starts on "Myself" so most people never have to touch it.
 * The value is a family member id (the user's own Self profile counts).
 */
export function FamilyPicker({ value, onChange, label = "Who is this medicine for?" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const me = useMe();
  const q = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled: !!me.data });
  const members = useMemo(() => q.data ?? [], [q.data]);

  useEffect(() => {
    if (!value && members.length) onChange((members.find((m) => m.relationship === "SELF") ?? members[0]).id);
  }, [value, members, onChange]);

  if (!me.data) return null;
  if (q.isPending) return <SkeletonCard lines={2} />;
  if (q.isError || !members.length) return null;
  return (
    <fieldset>
      <legend className="t-label mb-2">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
        {members.map((m) => <FamilyMemberCard key={m.id} member={m} compact selected={value === m.id} onSelect={() => onChange(m.id)} />)}
        <Link href="/family" className="tap flex items-center justify-center gap-2 rounded-card border-2 border-dashed border-line-strong p-3 font-semibold text-brand-700 hover:bg-brand-50"><Plus className="size-5" aria-hidden /> Add a family member</Link>
      </div>
    </fieldset>
  );
}
