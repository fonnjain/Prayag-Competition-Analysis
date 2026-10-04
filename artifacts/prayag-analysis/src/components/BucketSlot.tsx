import { useAuth } from "@workspace/replit-auth-web";
import { BucketControl } from "@workspace/api-client-react";

/** Shared bucket filter control. Renders nothing for anonymous visitors. */
export function BucketSlot() {
  const { user } = useAuth();
  if (!user) return null;
  return <BucketControl userId={user.id} />;
}
