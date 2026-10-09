import { useAuth } from "@workspace/replit-auth-web";
import type { ReactNode } from "react";
import { BucketControl, BucketPageHeader as SharedBucketPageHeader } from "@workspace/api-client-react";

/** Anonymous visitors have only a locked company layer, never a personal list. */
export function BucketSlot() {
  const { user } = useAuth();
  return <BucketControl userId={user?.id} />;
}

export function BucketPageHeader({ title }: { title: ReactNode }) {
  return <SharedBucketPageHeader title={title} control={<BucketSlot />} />;
}
