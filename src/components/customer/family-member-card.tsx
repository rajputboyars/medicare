"use client";
import clsx from "clsx";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Badge, IconButton } from "@/components/ui";
import type { FamilyMember } from "@/lib/types";

export const RELATION_LABEL: Record<FamilyMember["relationship"], string> = {
  SELF: "Myself", FATHER: "Father", MOTHER: "Mother", SPOUSE: "Spouse", CHILD: "Child", GRANDPARENT: "Grandparent", OTHER: "Other",
};
const GROUP: Record<FamilyMember["relationship"], string> = {
  SELF: "Self", FATHER: "Parent", MOTHER: "Parent", SPOUSE: "Family", CHILD: "Child", GRANDPARENT: "Grandparent", OTHER: "Other",
};
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** Friendly person card. `onSelect` makes the whole card a one-tap radio ("Who is this medicine for?"); `onEdit`/`onRemove` make it a manage card. */
export function FamilyMemberCard({ member, selected, onSelect, onEdit, onRemove, compact }: {
  member: FamilyMember; selected?: boolean; onSelect?: () => void; onEdit?: () => void; onRemove?: () => void; compact?: boolean;
}) {
  const body = (
    <>
      <span aria-hidden className={clsx("grid shrink-0 place-items-center rounded-full font-extrabold", compact ? "size-11 text-base" : "size-14 text-lg", selected ? "bg-brand-600 text-white" : "bg-brand-100 text-brand-800")}>
        {selected ? <Check className="size-6" /> : initials(member.name)}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="t-card block truncate">{member.relationship === "SELF" ? "Myself" : member.name}</span>
        <span className="t-caption block">{member.relationship === "SELF" ? member.name : RELATION_LABEL[member.relationship]} · {member.age} yrs</span>
        {!compact && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="blue">{GROUP[member.relationship]}</Badge>
            {member.allergies && <Badge tone="red">Allergy: {member.allergies}</Badge>}
          </span>
        )}
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button type="button" role="radio" aria-checked={!!selected} onClick={onSelect}
        className={clsx("flex w-full items-center gap-3 rounded-card border-2 p-3 text-left", selected ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:border-line-strong")}>
        {body}
      </button>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-soft">
      {body}
      <div className="flex shrink-0">
        {onEdit && <IconButton label={`Edit ${member.name}`} onClick={onEdit}><Pencil className="size-5" aria-hidden /></IconButton>}
        {onRemove && member.relationship !== "SELF" && <IconButton label={`Remove ${member.name}`} onClick={onRemove} className="text-emergency"><Trash2 className="size-5" aria-hidden /></IconButton>}
      </div>
    </div>
  );
}
