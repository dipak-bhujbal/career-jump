import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { decodeHtmlEntities, nowISO } from "../lib/utils";
import type { AppliedJobRecord } from "../types";

const client = new S3Client({});
const JOB_ARCHIVE_PATH_PREFIX = "tenants";
const MAX_SOURCE_HTML_BYTES = 512_000;

function jobArchiveBucketName(): string | null {
  return process.env.AWS_JOB_ARCHIVE_BUCKET ?? null;
}

function tenantArchivePrefix(tenantId?: string): string {
  return `${JOB_ARCHIVE_PATH_PREFIX}/${tenantId ?? "default"}/jobs/`;
}

function archiveObjectKey(tenantId: string | undefined, jobKey: string): string {
  return `${tenantArchivePrefix(tenantId)}${encodeURIComponent(jobKey)}/snapshot.html`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlToReferenceText(html: string): string {
  // Archive readable text instead of replaying third-party scripts from our
  // own origin. This keeps the snapshot safe while preserving the JD content.
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

  const withNewlines = withoutScripts
    .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withNewlines)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildArchivedJobDocument(
  record: AppliedJobRecord,
  capturedAt: string,
  summaryText: string,
  sourceUrl: string,
  fetchStatus: "captured" | "fallback",
  fetchNote?: string,
): string {
  const title = record.job.title || "Untitled role";
  const company = record.job.company || "Unknown company";
  const location = record.job.location || "Unknown location";
  const postedAt = record.job.postedAt || "Unknown";
  const note = fetchNote?.trim() ? fetchNote.trim() : "";
  const bodyText = summaryText.trim() || "No textual job description could be extracted from the source page.";

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>${escapeHtml(title)} · Archived job snapshot</title>`,
    "  <style>",
    "    :root { color-scheme: light; }",
    "    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #111827; }",
    "    main { max-width: 900px; margin: 0 auto; padding: 32px 20px 48px; }",
    "    .card { background: #fff; border: 1px solid #d9e1f2; border-radius: 16px; padding: 20px; margin-bottom: 18px; }",
    "    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }",
    "    h2 { margin-top: 0; }",
    "    .meta { color: #4b5563; font-size: 14px; margin: 4px 0; }",
    "    .pill { display: inline-block; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; margin-right: 8px; }",
    "    .note { background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 14px; border-radius: 12px; margin-top: 14px; }",
    "    pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; line-height: 1.55; margin: 0; }",
    "    a { color: #1d4ed8; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <section class=\"card\">",
    `      <span class=\"pill\">${fetchStatus === "captured" ? "Archived snapshot" : "Fallback snapshot"}</span>`,
    `      <h1>${escapeHtml(title)}</h1>`,
    `      <div class=\"meta\"><strong>Company:</strong> ${escapeHtml(company)}</div>`,
    `      <div class=\"meta\"><strong>Location:</strong> ${escapeHtml(location)}</div>`,
    `      <div class=\"meta\"><strong>Posted at:</strong> ${escapeHtml(postedAt)}</div>`,
    `      <div class=\"meta\"><strong>Captured at:</strong> ${escapeHtml(capturedAt)}</div>`,
    `      <div class=\"meta\"><strong>Original posting:</strong> <a href=\"${escapeHtml(sourceUrl)}\" target=\"_blank\" rel=\"noreferrer\">${escapeHtml(sourceUrl)}</a></div>`,
    note ? `      <div class=\"note\">${escapeHtml(note)}</div>` : "",
    "    </section>",
    "    <section class=\"card\">",
    "      <h2>Archived description</h2>",
    `      <pre>${escapeHtml(bodyText)}</pre>`,
    "    </section>",
    "  </main>",
    "</body>",
    "</html>",
  ].filter(Boolean).join("\n");
}

async function readResponseText(response: Response): Promise<string> {
  const source = await response.text();
  if (source.length <= MAX_SOURCE_HTML_BYTES) return source;
  return source.slice(0, MAX_SOURCE_HTML_BYTES);
}

async function captureArchivedJobDocument(record: AppliedJobRecord, sourceUrl: string): Promise<string> {
  if (!sourceUrl) {
    return buildArchivedJobDocument(
      record,
      nowISO(),
      `${record.job.title}\n\n${record.notes ?? ""}`.trim(),
      "",
      "fallback",
      "The original job posting URL was empty, so Career Jump stored a minimal fallback snapshot.",
    );
  }

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "career-jump/1.0 archive-capture",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const capturedAt = nowISO();
    const html = await readResponseText(response);
    const summaryText = htmlToReferenceText(html);
    return buildArchivedJobDocument(
      record,
      capturedAt,
      summaryText,
      sourceUrl,
      response.ok ? "captured" : "fallback",
      response.ok
        ? undefined
        : `The source page returned HTTP ${response.status}, so this snapshot stores the best text fallback we could derive.`,
    );
  } catch (error) {
    return buildArchivedJobDocument(
      record,
      nowISO(),
      `${record.job.title}\n\n${record.notes ?? ""}`.trim(),
      sourceUrl,
      "fallback",
      `Career Jump could not fetch the original job page during archival: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function archiveAppliedJobSnapshot(
  tenantId: string | undefined,
  record: AppliedJobRecord,
): Promise<AppliedJobRecord> {
  const bucketName = jobArchiveBucketName();
  if (!bucketName) return record;

  const sourceUrl = record.originalJobUrl ?? record.job.url;
  const key = archiveObjectKey(tenantId, record.jobKey);
  const body = await captureArchivedJobDocument(
    { ...record, originalJobUrl: sourceUrl },
    sourceUrl,
  );
  const archivedAt = nowISO();

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: "text/html; charset=utf-8",
    Metadata: {
      tenantId: tenantId ?? "default",
      jobKey: record.jobKey,
      company: record.job.company,
    },
  }));

  return {
    ...record,
    originalJobUrl: sourceUrl,
    archivedSnapshotKey: key,
    archivedAt,
  };
}

export async function loadArchivedJobSnapshotHtml(
  tenantId: string | undefined,
  record: AppliedJobRecord,
): Promise<string | null> {
  const bucketName = jobArchiveBucketName();
  if (!bucketName || !record.archivedSnapshotKey) return null;

  const response = await client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: record.archivedSnapshotKey,
  }));
  const body = response.Body;
  if (!body) return null;

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function deleteTenantArchivedJobSnapshots(tenantId: string | undefined): Promise<void> {
  const bucketName = jobArchiveBucketName();
  if (!bucketName) return;

  const prefix = tenantArchivePrefix(tenantId);
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const objects = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key));
    if (objects.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objects.map((Key) => ({ Key })),
          Quiet: true,
        },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}
