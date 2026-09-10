# Single Product Price Editor

## Location and product selection

The editor is an administrator-only page in Product Database at `/product-db/price-editor`. It has its own **Single Price Editor** navigation item and remains separate from bulk MRP loads and price revisions.

Administrators can find an existing catalogue product by:

- searching by item code or product name; or
- browsing the same division and category data used by Price Finder.

The editor cannot create a catalogue product. An unknown item code is rejected by the server.

## Effective-date wording

The server resolves the selected series and date before confirmation and returns one of three meanings:

- **Correction:** “This corrects the existing price for this period.” The confirmation states which same-date value is replaced.
- **Immediate:** “This takes effect immediately.” This applies to a new period dated today or earlier.
- **Scheduled:** “This is scheduled; the current price remains until then.” The confirmation shows the resolved preceding value that remains in force through the selected effective date.

The confirmation is bound to the exact preview request. Any change to the product, series, value, date, or remarks invalidates it and requires another preview.

## Stored audit data

Each successful edit records an immutable audit entry with:

- actor and timestamp;
- item code and price series;
- operation type;
- exact target-row old and new values;
- preceding resolved price for new periods;
- effective date and required remarks;
- target price-row identifier; and
- reversal linkage when applicable.

The price mutation, current-period recomputation, and audit insert occur in one transaction.

## Undo

Undo does not delete or rewrite the original audit. It verifies that the target price row still contains the value written by the original edit, restores the prior value or removes an editor-created row, recomputes current periods, and creates a separate reversal audit linked to the original.

An edit cannot be undone twice, and an older edit cannot overwrite a later correction.

## Creation boundaries

- Products cannot be created from this page.
- Competitor brands cannot be created from this page.
- Only competitor series already present in the pricing system can be selected.
- For an existing competitor with no mapped price for the selected product, the confirmation explicitly identifies that the save creates the product’s first competitor mapping.