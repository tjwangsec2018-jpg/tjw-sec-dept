import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.resolve(__dirname, '.quorumseal-storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const SAFE_FILE_RE = /^[a-zA-Z0-9_\-]+\.(pdf|png|jpg|jpeg)$/;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '18mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'quorumseal-api', timestamp: new Date().toISOString() });
  });

  // Upload PDF or wet-ink scan image and return a deterministic URL
  app.post('/api/pdfs/upload', (req, res) => {
    try {
      const { fileName, base64Data, contentType } = req.body as {
        fileName?: string;
        base64Data?: string;
        contentType?: string;
      };

      if (!base64Data || typeof base64Data !== 'string') {
        return res.status(400).json({ error: 'Missing base64Data payload.' });
      }

      const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(rawBase64, 'base64');

      if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ error: 'File must be between 1 byte and 15 MB.' });
      }

      let ext = 'pdf';
      if (contentType === 'image/png' || fileName?.toLowerCase().endsWith('.png')) {
        ext = 'png';
      } else if (
        contentType === 'image/jpeg' ||
        fileName?.toLowerCase().endsWith('.jpg') ||
        fileName?.toLowerCase().endsWith('.jpeg')
      ) {
        ext = 'jpg';
      }

      const safeStem = (fileName || 'resolution')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .slice(0, 48);
      const uniqueId = `${safeStem}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const targetPath = path.join(STORAGE_DIR, uniqueId);

      fs.writeFileSync(targetPath, buffer);

      return res.json({
        url: `/api/pdfs/${uniqueId}`,
        fileName: fileName || uniqueId,
        sizeBytes: buffer.length,
      });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Failed to store uploaded document.' });
    }
  });

  // Serve stored PDFs and wet-ink scans with inline headers
  app.get('/api/pdfs/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!SAFE_FILE_RE.test(filename)) {
      return res.status(400).json({ error: 'Invalid document identifier.' });
    }
    const targetPath = path.join(STORAGE_DIR, filename);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : 'image/jpeg';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(targetPath);
  });

  // Push Notification Dispatch Endpoint (FCM / Web Push + Realtime Firestore trigger acknowledgment)
  app.post('/api/push/dispatch', async (req, res) => {
    try {
      const { recipients, title, body, resolutionId, pendingCount, triggerType } = req.body as {
        recipients?: Array<{ email: string; name?: string; fcmToken?: string }>;
        title?: string;
        body?: string;
        resolutionId?: string;
        pendingCount?: number;
        triggerType?: string;
      };

      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'At least one recipient is required.' });
      }

      const fcmServerKey = process.env.FCM_SERVER_KEY;
      let fcmDispatchedCount = 0;

      if (fcmServerKey) {
        const tokens = recipients.map((r) => r.fcmToken).filter(Boolean) as string[];
        if (tokens.length > 0) {
          try {
            const fcmRes = await fetch('https://fcm.googleapis.com/fcm/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `key=${fcmServerKey}`,
              },
              body: JSON.stringify({
                registration_ids: tokens,
                notification: {
                  title: title || 'QuorumSeal — Resolution Signature Required',
                  body: body || 'Please review and sign your pending corporate resolution.',
                  badge: String(pendingCount ?? 1),
                  sound: 'default',
                },
                data: {
                  resolutionId: resolutionId || '',
                  pendingCount: String(pendingCount ?? 1),
                  triggerType: triggerType || 'manual_nudge',
                },
              }),
            });
            if (fcmRes.ok) {
              fcmDispatchedCount = tokens.length;
            }
          } catch (fcmErr) {
            console.warn('FCM external relay skipped:', fcmErr);
          }
        }
      }

      return res.json({
        dispatched: true,
        recipientCount: recipients.length,
        fcmDispatchedCount,
        channel: fcmDispatchedCount > 0 ? 'fcm+realtime-pwa' : 'realtime-pwa-badge',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Push dispatch error:', error);
      return res.status(500).json({ error: 'Failed to dispatch push notification.' });
    }
  });

  // Automated Escalation Rule Evaluator (7 days, 3 days, 48 hours before statutory deadline)
  app.post('/api/escalations/evaluate', (req, res) => {
    try {
      const { resolutions } = req.body as {
        resolutions?: Array<{
          id: string;
          title: string;
          companyName: string;
          statutoryDueDate: string;
          status: string;
          assignedDirectorEmails: string[];
          signedByEmails: string[];
          escalationSchedule: string[];
          sentEscalations: string[];
        }>;
      };

      if (!Array.isArray(resolutions)) {
        return res.status(400).json({ error: 'Invalid resolutions array.' });
      }

      const now = Date.now();
      const dueEscalations: Array<{
        resolutionId: string;
        title: string;
        companyName: string;
        stage: 'escalation_7d' | 'escalation_3d' | 'escalation_48h';
        stageKey: string;
        unsignedEmails: string[];
        message: string;
      }> = [];

      for (const item of resolutions) {
        if (item.status === 'signed') continue;
        const dueMs = new Date(`${item.statutoryDueDate}T23:59:59Z`).getTime();
        if (Number.isNaN(dueMs)) continue;

        const hoursLeft = (dueMs - now) / (1000 * 60 * 60);
        const signedSet = new Set((item.signedByEmails || []).map((e) => e.toLowerCase()));
        const unsignedEmails = (item.assignedDirectorEmails || []).filter(
          (email) => !signedSet.has(email.toLowerCase())
        );

        if (unsignedEmails.length === 0) continue;

        const sent = new Set(item.sentEscalations || []);
        const schedule = new Set(item.escalationSchedule || ['7d', '3d', '48h']);

        if (schedule.has('48h') && hoursLeft <= 48 && !sent.has('48h')) {
          dueEscalations.push({
            resolutionId: item.id,
            title: item.title,
            companyName: item.companyName,
            stage: 'escalation_48h',
            stageKey: '48h',
            unsignedEmails,
            message:
              hoursLeft < 0
                ? `URGENT: "${item.title}" for ${item.companyName} is past its statutory deadline (${item.statutoryDueDate}). Immediate signature required.`
                : `48-Hour Statutory Escalation: "${item.title}" for ${item.companyName} is due within 48 hours (${item.statutoryDueDate}).`,
          });
        } else if (schedule.has('3d') && hoursLeft <= 72 && hoursLeft > 48 && !sent.has('3d')) {
          dueEscalations.push({
            resolutionId: item.id,
            title: item.title,
            companyName: item.companyName,
            stage: 'escalation_3d',
            stageKey: '3d',
            unsignedEmails,
            message: `3-Day Reminder: "${item.title}" for ${item.companyName} is due on ${item.statutoryDueDate}.`,
          });
        } else if (schedule.has('7d') && hoursLeft <= 168 && hoursLeft > 72 && !sent.has('7d')) {
          dueEscalations.push({
            resolutionId: item.id,
            title: item.title,
            companyName: item.companyName,
            stage: 'escalation_7d',
            stageKey: '7d',
            unsignedEmails,
            message: `7-Day Statutory Notice: "${item.title}" for ${item.companyName} is scheduled for completion by ${item.statutoryDueDate}.`,
          });
        }
      }

      return res.json({
        evaluatedCount: resolutions.length,
        dueEscalations,
        evaluatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Escalation evaluation error:', error);
      return res.status(500).json({ error: 'Failed to evaluate escalations.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QuorumSeal server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
