import type { BucketListRecord } from "@workspace/db";

type SelectableList = Pick<BucketListRecord, "id" | "name" | "type" | "ownerId" | "visibility">;
type Preference = { activeListId?: string | null; excludedListIds?: string[] };

/** P053 Step 5: read old preferences without rewriting them. The singleton ID
 * may still name an Excluded list; new writes store only Included there. */
export function resolvePersonalSelection(
  preference: Preference | undefined, lists: Map<string, SelectableList>,
  actorId: string, enforcedId: string | null,
) {
  const visible = (id: string | null | undefined) => {
    const list = id ? lists.get(id) : null;
    return list && list.id !== enforcedId
      && (list.ownerId === actorId || list.visibility === "everyone") ? list : null;
  };
  const legacy = visible(preference?.activeListId);
  const included = legacy?.type === "included" ? legacy : null;
  const excludedIds = new Set(preference?.excludedListIds ?? []);
  if (legacy?.type === "excluded") excludedIds.add(legacy.id);
  const excluded = [...excludedIds].map(visible)
    .filter((list): list is SelectableList => !!list && list.type === "excluded")
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { included, excluded, personalLists: [...(included ? [included] : []), ...excluded] };
}

export function updatePersonalSelection(
  current: ReturnType<typeof resolvePersonalSelection>,
  target: SelectableList | null, active = true,
) {
  if (!target) return { activeListId: null, excludedListIds: [] as string[], message: undefined };
  let included = current.included;
  const excludedIds = new Set(current.excluded.map(list => list.id));
  let message: string | undefined;
  if (target.type === "included") {
    if (active) {
      if (included && included.id !== target.id)
        message = `Included list “${included.name}” replaced by “${target.name}”.`;
      included = target;
    } else if (included?.id === target.id) included = null;
  } else if (active) excludedIds.add(target.id);
  else excludedIds.delete(target.id);
  return { activeListId: included?.id ?? null, excludedListIds: [...excludedIds].sort(), message };
}
