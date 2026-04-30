function doPost(e) {
  var sharedSecret = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
  var body = parseRequestBody(e);
  var requestSecret = body.sharedSecret || "";

  /**
   * Apps Script web apps do not reliably expose arbitrary HTTP headers to
   * doPost(), so the shared secret must be present in the JSON payload if
   * this deployment wants to enforce it.
   */
  if (sharedSecret && (!requestSecret || sharedSecret !== requestSecret)) {
    return jsonResponse({ ok: false, error: "unauthorized" });
  }

  var newJobs = Array.isArray(body.newJobs) ? body.newJobs.slice() : [];
  var updatedJobs = Array.isArray(body.updatedJobs) ? body.updatedJobs.slice() : [];
  var jobs = Array.isArray(body.jobs) ? body.jobs.slice() : [];

  if (!newJobs.length && !updatedJobs.length && jobs.length) {
    newJobs = jobs.slice();
  }

  if (!newJobs.length && !updatedJobs.length) {
    return ContentService.createTextOutput("no jobs").setMimeType(ContentService.MimeType.TEXT);
  }

  /**
   * Force email branding to Career Jump regardless of caller payload.
   */
  var appName = "Career Jump";

  /**
   * Defensive sort by raw posted timestamp descending so newest jobs
   * always appear first in the email.
   */
  newJobs.sort(function(a, b) {
    var aMs = parsePostedAtMillis(a && a.postedAtRaw);
    var bMs = parsePostedAtMillis(b && b.postedAtRaw);
    return bMs - aMs;
  });

  updatedJobs.sort(function(a, b) {
    var aMs = parsePostedAtMillis(a && a.postedAtRaw);
    var bMs = parsePostedAtMillis(b && b.postedAtRaw);
    return bMs - aMs;
  });

  var html = buildHtmlEmail(appName, body.runAt || "", newJobs, updatedJobs);
  var subjectParts = [];
  if (newJobs.length) subjectParts.push(newJobs.length + " new job" + (newJobs.length === 1 ? "" : "s"));
  if (updatedJobs.length) subjectParts.push(updatedJobs.length + " updated job" + (updatedJobs.length === 1 ? "" : "s"));

  /**
   * Multi-user delivery must use the webhook payload recipient.
   *
   * Never fall back to script properties or Session.* here. Those values refer
   * to the script owner/execution identity and can silently route mail to the
   * wrong person even when the scan belongs to a different user.
   */
  var recipient = resolveRecipientEmail(body.recipient);
  if (!recipient) {
    throw new Error("Missing payload.recipient. Refusing to send email without an explicit recipient.");
  }

  var subject = String(body.subject || "").trim() || ("Career Jump: " + subjectParts.join(" · "));

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: html,
    name: appName
  });

  return jsonResponse({ ok: true, recipient: recipient });
}

function parseRequestBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error("Invalid JSON request body");
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function parsePostedAtMillis(value) {
  if (!value) return 0;
  var ms = new Date(value).getTime();
  return isNaN(ms) ? 0 : ms;
}

function resolveRecipientEmail(payloadRecipient) {
  if (payloadRecipient && String(payloadRecipient).trim()) {
    return String(payloadRecipient).trim();
  }
  return "";
}

function buildHtmlEmail(appName, runAt, newJobs, updatedJobs) {
  var newJobCards = newJobs.map(function(job) {
    return [
      '<div style="border:1px solid #dde3f0;border-radius:14px;padding:16px;margin:0 0 14px;background:#ffffff;">',
      '<div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:4px;">' + escapeHtml(job.jobTitle) + '</div>',
      '<div style="font-size:14px;color:#4b5563;margin-bottom:10px;">' +
        escapeHtml(job.company) + ' · ' +
        escapeHtml(job.location) + ' · ' +
        escapeHtml(job.postedAt) +
      '</div>',
      '<a href="' + escapeHtml(job.url) + '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">Open role</a>',
      '</div>'
    ].join("");
  }).join("");

  var updatedJobCards = updatedJobs.map(function(job) {
    var changes = Array.isArray(job.updateChanges) ? job.updateChanges : [];
    var changeList = changes.length
      ? '<ul style="margin:10px 0 0 18px;padding:0;color:#7c2d12;font-size:14px;">' + changes.map(function(change) {
          return '<li style="margin:0 0 6px;">' +
            '<strong>' + escapeHtml(change.field) + ':</strong> ' +
            escapeHtml(change.previous || "Unknown") + ' → ' +
            escapeHtml(change.current || "Unknown") +
          '</li>';
        }).join("") + '</ul>'
      : "";

    var justification = job.updateJustification
      ? '<div style="font-size:14px;color:#9a3412;margin-top:10px;">' + escapeHtml(job.updateJustification) + '</div>'
      : "";

    return [
      '<div style="border:1px solid #fed7aa;border-radius:14px;padding:16px;margin:0 0 14px;background:#fff7ed;">',
      '<div style="font-size:18px;font-weight:700;color:#7c2d12;margin-bottom:4px;">' + escapeHtml(job.jobTitle) + '</div>',
      '<div style="font-size:14px;color:#9a3412;margin-bottom:10px;">' +
        escapeHtml(job.company) + ' · ' +
        escapeHtml(job.location) + ' · ' +
        escapeHtml(job.postedAt) +
      '</div>',
      '<a href="' + escapeHtml(job.url) + '" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">Open role</a>',
      justification,
      changeList,
      '</div>'
    ].join("");
  }).join("");

  var updatedSummary = updatedJobs.length
    ? [
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:16px 18px;margin:0 0 18px;">',
        '<div style="font-size:18px;font-weight:800;color:#9a3412;margin-bottom:6px;">Updated jobs</div>',
        '<div style="font-size:15px;color:#7c2d12;">' + updatedJobs.length + ' updated job' + (updatedJobs.length === 1 ? "" : "s") + ' found in the latest run.</div>',
        '</div>'
      ].join("")
    : "";

  var newJobsSection = newJobs.length
    ? [
        '<div style="margin:0 0 12px;">',
        '<div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:10px;">New jobs</div>',
        newJobCards,
        '</div>'
      ].join("")
    : "";

  var updatedJobsSection = updatedJobs.length
    ? [
        '<div style="margin:0 0 12px;">',
        '<div style="font-size:18px;font-weight:800;color:#9a3412;margin-bottom:10px;">Updated jobs</div>',
        updatedJobCards,
        '</div>'
      ].join("")
    : "";

  var emptyNewJobsNote = !newJobs.length && updatedJobs.length
    ? '<div style="font-size:15px;color:#4b5563;background:#ffffff;border:1px solid #dde3f0;border-radius:14px;padding:16px;">No new jobs in this run. Email sent because updated jobs were detected.</div>'
    : "";

  return [
    '<div style="background:#f4f7fb;padding:28px;font-family:Arial,sans-serif;color:#111827;">',
    '<div style="max-width:760px;margin:0 auto;">',
    '<div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#ffffff;padding:22px;border-radius:18px;margin-bottom:18px;">',
    '<div style="font-size:24px;font-weight:800;">' + escapeHtml(appName) + '</div>',
    '<div style="font-size:15px;opacity:.95;margin-top:6px;">' +
      newJobs.length + ' new · ' + updatedJobs.length + ' updated · ' + escapeHtml(runAt) +
    '</div>',
    '</div>',
    updatedSummary,
    newJobsSection,
    updatedJobsSection,
    emptyNewJobsNote,
    '</div>',
    '</div>'
  ].join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
