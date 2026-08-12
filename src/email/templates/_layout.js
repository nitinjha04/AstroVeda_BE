const config = require('../../config');

const shell = (title, bodyHtml) => `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f4ef;font-family:Georgia,serif;">
  <div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #eee7da;border-radius:16px;overflow:hidden;">
    <div style="padding:20px 24px;background:#5A4BFF;color:#fff;">
      <p style="margin:0;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.85;">${config.appName}</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:normal;">${title}</h1>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:15px;line-height:1.55;">${bodyHtml}</div>
    <div style="padding:14px 24px;border-top:1px solid #eee7da;color:#6b7280;font-size:12px;">
      This is an automated message from ${config.appName}.
    </div>
  </div>
</body></html>`;

module.exports = { shell };
