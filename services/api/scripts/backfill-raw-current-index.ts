import { putRow, rawScansTableName, scanAllRows } from "../src/aws/dynamo";

type RawScanCurrentRow = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk?: string;
  gsi2sk?: string;
  entityType?: string;
  company?: string;
  companySlug?: string;
  scannedAt?: string;
  [key: string]: unknown;
};

const CURRENT_INDEX_PK = "RAW_SCAN_CURRENT";

async function main() {
  const rows = await scanAllRows<RawScanCurrentRow>(rawScansTableName(), {
    filterExpression: "entityType = :entityType",
    expressionAttributeValues: { ":entityType": "RAW_SCAN_CURRENT" },
  });

  let updated = 0;
  for (const row of rows) {
    if (!row.companySlug || !row.scannedAt) continue;
    if (row.gsi2pk === CURRENT_INDEX_PK && row.gsi2sk) continue;
    await putRow(rawScansTableName(), {
      ...row,
      gsi2pk: CURRENT_INDEX_PK,
      gsi2sk: `${row.companySlug}#${row.scannedAt}`,
    });
    updated += 1;
  }

  console.log(JSON.stringify({
    table: rawScansTableName(),
    scanned: rows.length,
    updated,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
