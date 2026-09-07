import { and, eq } from "drizzle-orm";
import {
  catalogProductNameCorrectionsTable,
  catalogProductsTable,
  db,
} from "@workspace/db";

export const CH_VALVE_NAME_CORRECTION_REASON =
  "Correct concealed-valve range names and the confirmed TRIANGULAR spelling; TRIANGULER is a source spelling error.";

type NameCorrection = {
  itemCode: string;
  expectedNames: readonly string[];
  correctedName: string;
};

export const CH_VALVE_NAME_CORRECTIONS: readonly NameCorrection[] = [
  {
    itemCode: "CH82F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch TRIANGULAR",
  },
  {
    itemCode: "CH84F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch GRACIA",
  },
  {
    itemCode: "CH86F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch MACASA",
  },
  {
    itemCode: "CH88F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch URBONA",
  },
  {
    itemCode: "CH89F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch SAGA",
  },
  {
    itemCode: "CH90F",
    expectedNames: ["Full Turn Concealed Valve"],
    correctedName: "Full Turn Concealed Valve 1 inch VIVA",
  },
  {
    itemCode: "CH82",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName:
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR",
  },
  {
    itemCode: "CH84",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName: "Long Concealed Valve (Quarter Turn) 1 inch GRACIA",
  },
  {
    itemCode: "CH86",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName: "Long Concealed Valve (Quarter Turn) 1 inch MACASA",
  },
  {
    itemCode: "CH88",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName: "Long Concealed Valve (Quarter Turn) 1 inch URBONA",
  },
  {
    itemCode: "CH89",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName: "Long Concealed Valve (Quarter Turn) 1 inch SAGA",
  },
  {
    itemCode: "CH90",
    expectedNames: ['1" Long Concealed Valve (Quarter Turn)'],
    correctedName: "Long Concealed Valve (Quarter Turn) 1 inch VIVA",
  },
  {
    itemCode: "CH72",
    expectedNames: [
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULER",
    ],
    correctedName:
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72F",
    expectedNames: ["Full Turn Concealed Valve 3⁄4 inch TRIANGULER"],
    correctedName: "Full Turn Concealed Valve 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72QS",
    expectedNames: [
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULER",
    ],
    correctedName:
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72 F",
    expectedNames: ["Full Turn Concealed Valve 3⁄4 inch TRIANGULER"],
    correctedName: "Full Turn Concealed Valve 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "CH72 QS",
    expectedNames: [
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULER",
    ],
    correctedName:
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR",
  },
  {
    itemCode: "UH-72",
    expectedNames: [
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULER mm",
    ],
    correctedName:
      "Long Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH72-S",
    expectedNames: [
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULER mm",
    ],
    correctedName:
      "Short Concealed Valve (Quarter Turn) 3⁄4 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82",
    expectedNames: [
      "Long Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULER mm",
    ],
    correctedName:
      "Long Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82-S",
    expectedNames: [
      "Short Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULER mm",
    ],
    correctedName:
      "Short Concealed Valve (Quarter Turn) 1⁄2 inch TRIANGULAR mm",
  },
  {
    itemCode: "UH82-F",
    expectedNames: [
      "Full Turn Concealed Valve",
      "Full Turn Concealed Valve 1 inch TRIANGULER",
    ],
    correctedName: "Full Turn Concealed Valve 1 inch TRIANGULAR",
  },
  {
    itemCode: "UH82-L",
    expectedNames: [
      "Long Concealed Valve (Quarter Turn)",
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULER",
    ],
    correctedName:
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR",
  },
] as const;

export async function applyChValveNameCorrections() {
  return db.transaction(async (tx) => {
    let changed = 0;
    let alreadyCorrect = 0;

    for (const correction of CH_VALVE_NAME_CORRECTIONS) {
      const [product] = await tx
        .select({
          productName: catalogProductsTable.productName,
        })
        .from(catalogProductsTable)
        .where(eq(catalogProductsTable.itemCode, correction.itemCode))
        .limit(1);

      if (!product) {
        throw new Error(
          `CH valve name correction target not found: ${correction.itemCode}`,
        );
      }

      const currentName = product.productName;
      if (
        currentName !== correction.correctedName &&
        !correction.expectedNames.includes(currentName ?? "")
      ) {
        throw new Error(
          `CH valve name correction refused for ${correction.itemCode}: unexpected current name "${currentName ?? ""}"`,
        );
      }

      if (currentName !== correction.correctedName) {
        const updated = await tx
          .update(catalogProductsTable)
          .set({
            productName: correction.correctedName,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogProductsTable.itemCode, correction.itemCode),
              eq(catalogProductsTable.productName, currentName!),
            ),
          )
          .returning({ itemCode: catalogProductsTable.itemCode });
        if (updated.length !== 1) {
          throw new Error(
            `CH valve name correction lost a concurrent update for ${correction.itemCode}`,
          );
        }
        changed += 1;
      } else {
        alreadyCorrect += 1;
      }

      await tx
        .insert(catalogProductNameCorrectionsTable)
        .values({
          correctionKey: `${
            correction.itemCode.startsWith("UH")
              ? "uh-triangular-spelling-2026-09"
              : "ch-concealed-valve-names-2026-09"
          }:${correction.itemCode}`,
          itemCode: correction.itemCode,
          previousName: currentName,
          correctedName: correction.correctedName,
          reason: CH_VALVE_NAME_CORRECTION_REASON,
        })
        .onConflictDoNothing({
          target: catalogProductNameCorrectionsTable.correctionKey,
        });
    }

    return {
      total: CH_VALVE_NAME_CORRECTIONS.length,
      changed,
      alreadyCorrect,
    };
  });
}