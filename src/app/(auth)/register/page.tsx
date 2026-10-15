import { redirect } from "next/navigation";

/** Sign-up and sign-in are the same mobile-first flow now. */
export default function RegisterPage() {
  redirect("/login");
}
