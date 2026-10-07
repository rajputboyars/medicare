"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { z } from "zod";
import { api, del, post, put } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { familyMemberSchema } from "@/lib/validation";
import { Badge, Button, Card, EmptyState, Input, LinkButton, Notice, PageTitle, QueryBoundary, Select, SkeletonList } from "@/components/ui";
import type { FamilyMember, Pharmacy, Prescription } from "@/lib/types";

type Form = z.input<typeof familyMemberSchema>;

function MemberForm({ member, pharmacies, onDone }: { member?: FamilyMember; pharmacies: Pharmacy[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(familyMemberSchema),
    defaultValues: member ? { ...member, currentMedicines: member.currentMedicines } : { gender: "FEMALE", relationship: "MOTHER", currentMedicines: [] },
  });
  const [meds, setMeds] = useState(member?.currentMedicines.join(", ") ?? "");
  const save = useMutation({
    mutationFn: (v: Form) => { const body = { ...v, currentMedicines: meds.split(",").map((s) => s.trim()).filter(Boolean), preferredPharmacyId: v.preferredPharmacyId || undefined }; return member ? put(`/api/family/${member.id}`, body) : post("/api/family", body); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["family"] }); onDone(); },
  });
  return (
    <Card>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <h2 className="text-lg font-extrabold">{member ? "Edit profile" : "Add family member"}</h2>
        {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required error={errors.name?.message} {...register("name")} />
          <Input label="Age" type="number" inputMode="numeric" required error={errors.age?.message} {...register("age")} />
          <Select label="Gender" {...register("gender")}><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>
          <Select label="Relationship" {...register("relationship")}>{["SELF", "FATHER", "MOTHER", "SPOUSE", "CHILD", "GRANDPARENT", "OTHER"].map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}</Select>
          <Input label="Blood group (optional)" maxLength={5} {...register("bloodGroup")} />
          <Select label="Preferred pharmacy" {...register("preferredPharmacyId")}><option value="">No preference</option>{pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </div>
        <Input label="Allergies (optional)" hint="Example: Penicillin, dust" {...register("allergies")} />
        <Input label="Current medicines (optional)" hint="Separate with commas" value={meds} onChange={(e) => setMeds(e.target.value)} />
        <div className="flex gap-2"><Button type="submit" loading={save.isPending}>Save</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
      </form>
    </Card>
  );
}

export default function Family() {
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FamilyMember | "new" | null>(null);
  const q = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled: !!me.data });
  const rx = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: !!me.data });
  const ph = useQuery({ queryKey: ["pharmacies", "261001"], queryFn: () => api<Pharmacy[]>("/api/pharmacies/nearby?pincode=261001"), enabled: !!me.data });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/family/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["family"] }) });

  if (me.isPending) return <SkeletonList />;
  if (!me.data) return (<><PageTitle title="Family profiles" /><EmptyState title="Log in to manage your family" action={<LinkButton href="/login?next=/family">Log in</LinkButton>} /></>);

  return (
    <>
      <PageTitle title="Family profiles" subtitle="Order medicines and book services for parents, children and grandparents." action={<Button onClick={() => setEditing("new")}><Plus className="size-5" aria-hidden /> Add member</Button>} />
      {editing && <div className="mb-4"><MemberForm member={editing === "new" ? undefined : editing} pharmacies={ph.data ?? []} onDone={() => setEditing(null)} /></div>}
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-32" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No family members yet" />}>
        {(list) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((f) => {
              const myRx = rx.data?.filter((r) => r.familyMemberId === f.id) ?? [];
              return (
                <Card as="li" key={f.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="text-lg font-bold">{f.name}</h3><p className="text-sm text-muted">{f.relationship.toLowerCase()} · {f.age} yrs · {f.gender.toLowerCase()}{f.bloodGroup ? ` · ${f.bloodGroup}` : ""}</p></div>
                    <div className="flex"><Button variant="ghost" className="min-w-12 px-0" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`}><Pencil className="size-5" aria-hidden /></Button>
                      {f.relationship !== "SELF" && <Button variant="ghost" className="min-w-12 px-0 text-emergency" onClick={() => remove.mutate(f.id)} aria-label={`Remove ${f.name}`}><Trash2 className="size-5" aria-hidden /></Button>}</div>
                  </div>
                  {f.allergies && <Badge tone="red">Allergy: {f.allergies}</Badge>}
                  {f.currentMedicines.length > 0 && <p className="text-sm"><b>Current medicines:</b> {f.currentMedicines.join(", ")}</p>}
                  <p className="text-sm text-muted">{myRx.length} prescription{myRx.length === 1 ? "" : "s"} saved{f.preferredPharmacyId && ph.data ? ` · Preferred: ${ph.data.find((p) => p.id === f.preferredPharmacyId)?.name ?? "—"}` : ""}</p>
                </Card>
              );
            })}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
