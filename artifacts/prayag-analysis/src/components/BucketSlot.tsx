import { useAuth } from "@workspace/replit-auth-web";
import type { ReactNode } from "react";
import { BucketControl, BucketPageHeader as SharedBucketPageHeader } from "@workspace/api-client-react";

/** Shared bucket filter control. Renders nothing for anonymous visitors. */
export function BucketSlot() {
  const { user } = useAuth();
  if (!user) return null;
  return <BucketControl userId={user.id} />;
}

export function BucketPageHeader({ title }: { title: ReactNode }) {
  return <SharedBucketPageHeader title={title} control={<BucketSlot />} />;
}
