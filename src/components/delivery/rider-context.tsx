"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch } from "@/lib/api";

export interface RiderMe { name: string; vehicle: string; available: boolean; verification: string; activeJobs: number; earningsToday: number; deliveriesToday: number }

export function useRiderMe() {
  return useQuery({ queryKey: ["rider-me"], queryFn: () => api<RiderMe>("/api/delivery/me"), refetchInterval: 30_000 });
}

export function useToggleOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (available: boolean) => patch("/api/delivery/me", { available }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rider-me"] }); qc.invalidateQueries({ queryKey: ["rider-available"] }); },
  });
}
