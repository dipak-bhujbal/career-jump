import {
  ConditionalCheckFailedException,
  jobsTableName,
  putRow,
  summariesTableName,
} from "../aws/dynamo";
import type {
  MaterializerFreshnessRow,
  MaterializerRow,
  UpsertReadModelRowInput,
} from "./types";

const UPSERT_IF_NEWER_CONDITION = [
  "attribute_not_exists(pk)",
  "#rowSchemaVersion < :rowSchemaVersion",
  "(#rowSchemaVersion = :rowSchemaVersion AND #configVersion < :configVersion)",
  "(#rowSchemaVersion = :rowSchemaVersion AND #configVersion = :configVersion AND #inventoryVersion < :inventoryVersion)",
  "(#rowSchemaVersion = :rowSchemaVersion AND #configVersion = :configVersion AND #inventoryVersion = :inventoryVersion AND #builtAt <= :builtAt)",
].join(" OR ");

function tableName(table: "jobs" | "summaries"): string {
  return table === "jobs" ? jobsTableName() : summariesTableName();
}

function freshnessExpressionValues(row: MaterializerFreshnessRow): Record<string, unknown> {
  return {
    ":rowSchemaVersion": row.rowSchemaVersion,
    ":configVersion": row.configVersion,
    ":inventoryVersion": row.inventoryVersion,
    ":builtAt": row.builtAt,
  };
}

/**
 * All read-model writes go through one shared primitive so later phases can
 * strengthen idempotency semantics in one place instead of across builders.
 */
export async function upsertReadModelRow<Row extends MaterializerRow>(
  input: UpsertReadModelRowInput<Row>,
): Promise<boolean> {
  const row = input.row as MaterializerFreshnessRow;

  try {
    await putRow(tableName(input.table), input.row as Record<string, unknown>, {
      conditionExpression: UPSERT_IF_NEWER_CONDITION,
      expressionAttributeNames: {
        "#rowSchemaVersion": "rowSchemaVersion",
        "#configVersion": "configVersion",
        "#inventoryVersion": "inventoryVersion",
        "#builtAt": "builtAt",
      },
      expressionAttributeValues: freshnessExpressionValues(row),
    });
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}
