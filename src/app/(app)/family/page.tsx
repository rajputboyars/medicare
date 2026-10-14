"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import clsx from "clsx";
import type { z } from "zod";
import { api, del, post, put } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { familyMemberSchema } from "@/lib/validation";
import { FamilyMemberCard, RELATION_LABEL } from "@/components/customer/family-member-card";
import { Button, ConfirmationDialog, EmptyState, Input, LinkButton, Modal, Notice, PageTitle, QueryBoundary, Select, SkeletonList } from "@/components/ui";
import type { FamilyMember, Pharmacy } from "@/lib/types";

type Form = z.input<typeof familyMemberSchema>;
const RELATIONS = ["SELF", "FATHER", "MOTHER", "SPOUSE", "CHILD", "GRANDPARENT", "OTHER"] as const;

/** One person: big relationship chips first (that is what people think of), then the few details that matter. */
function MemberSheet({ member, pharmacies, onClose }: { member?: FamilyMember; pharmacies: Pharmacy[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, setValue, control, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(familyMemberSchema),
    defaultValues: member ? { ...member } : { gender: "FEMALE", relationship: "MOTHER", currentMedicines: [] },
  });
  const relationship = useWatch({ control, name: "relationship" });
  const gender = useWatch({ control, name: "gender" });
  const [meds, setMeds] = useState(member?.currentMedicines.join(", ") ?? "");
  const save = useMutation({
    mutationFn: (v: Form) => {
      const body = { ...v, currentMedicines: meds.split(",").map((s) => s.trim()).filter(Boolean), preferredPharmacyId: v.preferredPharmacyId || undefined };
      return member ? put(`/api/family/${member.id}`, body) : post("/api/family", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family"] }); onClose(); },
  });

  const chip = (on: boolean) => clsx("tap rounded-pill border-2 px-4 text-sm", on ? "border-brand-600 bg-brand-600 font-bold text-white" : "border-line-strong bg-surface font-semibold hover:bg-surface-2");
  return (
    <Modal open onClose={onClose} title={member ? "Edit family member" : "Add a family member"}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
        <fieldset><legend className="t-label mb-2">Who are they to you?</legend>
          <div role="radiogroup" aria-label="Relationship" className="flex flex-wrap gap-2">
            {RELATIONS.map((r) => <button key={r} type="button" role="radio" aria-checked={relationship === r} className={chip(relationship === r)} onClick={() => setValue("relationship", r)}>{RELATION_LABEL[r]}</button>)}
          </div></fieldset>
        <Input label="Name" required error={errors.name?.message} {...register("name")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Age" type="number" inputMode="numeric" required error={errors.age?.message} {...register("age")} />
          <fieldset><legend className="t-label mb-1.5">Gender</legend>
            <div role="radiogroup" aria-label="Gender" className="flex flex-wrap gap-2">
              {(["FEMALE", "MALE", "OTHER"] as const).map((g) => <button key={g} type="button" role="radio" aria-checked={gender === g} className={chip(gender === g)} onClick={() => setValue("gender", g)}>{g.charAt(0) + g.slice(1).toLowerCase()}</button>)}
            </div></fieldset>
        </div>
        <Input label="Allergies" hint="Optional. Example: Penicillin, dust" {...register("allergies")} />
        <Input label="Medicines they take now" hint="Optional. Separate with commas" value={meds} onChange={(e) => setMeds(e.target.value)} />
        <Select label="Preferred pharmacy" {...register("preferredPharmacyId")}><option value="">No preference</option>{pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

export default function Family() {
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FamilyMember | "new" | null>(null);
  const [removing, setRemoving] = useState<FamilyMember>();
  const enabled = me.data?.role === "CUSTOMER";
  const q = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled });
  const ph = useQuery({ queryKey: ["pharmacies", "261001"], queryFn: () => api<Pharmacy[]>("/api/pharmacies/nearby?pincode=261001"), enabled });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/family/${id}`), onSuccess: () => { setRemoving(undefined); qc.invalidateQueries({ queryKey: ["family"] }); } });

  if (me.isPending) return <SkeletonList />;
  if (!enabled) return (<><PageTitle title="Family profiles" /><EmptyState title="Log in to manage your family" action={<LinkButton href="/login?next=/family">Log in</LinkButton>} /></>);

  return (
    <>
      <PageTitle back={{ href: "/profile", label: "Profile" }} title="Family profiles" subtitle="Order medicines for parents, children and grandparents. Choosing who it is for takes one tap." action={<Button onClick={() => setEditing("new")}><Plus className="size-5" aria-hidden /> Add member</Button>} />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} media lines={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No family members yet" action={<Button onClick={() => setEditing("new")}>Add a family member</Button>} />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((f) => <li key={f.id}><FamilyMemberCard member={f} onEdit={() => setEditing(f)} onRemove={() => setRemoving(f)} /></li>)}
          </ul>
        )}
      </QueryBoundary>

      {editing && <MemberSheet member={editing === "new" ? undefined : editing} pharmacies={ph.data ?? []} onClose={() => setEditing(null)} />}
      <ConfirmationDialog open={!!removing} onClose={() => setRemoving(undefined)} tone="danger" title={`Remove ${removing?.name ?? "this person"}?`}
        description="Their past orders stay in your history. You can add them again anytime." confirmLabel="Yes, remove" cancelLabel="Keep"
        loading={remove.isPending} error={remove.isError ? (remove.error as Error).message : undefined} onConfirm={() => removing && remove.mutate(removing.id)} />
    </>
  );
}
