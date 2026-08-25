import { z } from "zod";
import type { NormalizedRecord, RelationshipEdge } from "@/lib/contracts";

export const composioToolResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  successful: z.boolean(),
  logId: z.string().optional(),
  sessionInfo: z.unknown().optional()
});
export type ComposioToolResponse = z.infer<typeof composioToolResponseSchema>;

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown, fallback = "") { return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback; }
function strings(value: unknown) { return Array.isArray(value) ? value.map((item) => string(typeof item === "object" ? object(item).name ?? object(item).email ?? object(item).login : item)).filter(Boolean) : []; }
function date(value: unknown) { const result = value ? new Date(typeof value === "number" ? value : string(value)) : undefined; return result && !Number.isNaN(result.getTime()) ? result : undefined; }
function tombstoneDate(item: Record<string, unknown>) {
  const status = string(item.status).toLowerCase();
  return item.deleted === true || item.removed === true || item.trashed === true || ["deleted", "removed", "trashed"].includes(status)
    ? date(item.deleted_at ?? item.deletedAt ?? item.modifiedTime) ?? new Date()
    : undefined;
}
function httpUrl(value: unknown) {
  const candidate = string(value);
  try { return ["http:", "https:"].includes(new URL(candidate).protocol) ? candidate : undefined; }
  catch { return undefined; }
}
function markdownJson(value: unknown) { return `\n\n\`\`\`json\n${JSON.stringify(value, null, 2).slice(0, 60_000)}\n\`\`\``; }

function findItems(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["messages", "files", "results", "items", "issues", "pages", "emails", "threads", "values", "records"]) {
    if (Array.isArray(data[key])) return data[key].map(object).filter((item) => Object.keys(item).length);
  }
  for (const value of Object.values(data)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findItems(object(value));
      if (nested.length) return nested;
    }
  }
  return Object.keys(data).length ? [data] : [];
}

function edge(fromExternalId: string, toExternalId: string, type: RelationshipEdge["type"], label?: string): RelationshipEdge {
  return { fromExternalId, toExternalId, type, label, metadata: {} };
}

function slack(items: Record<string, unknown>[], sourceId: string): NormalizedRecord[] {
  const records = items.flatMap((item) => {
    const externalId = string(item.ts ?? item.id ?? item.client_msg_id);
    if (!externalId) return [];
    const text = string(item.text, "(empty message)");
    const channel = string(item.channel_name ?? item.channel);
    const channelId = string(item.channel);
    const thread = string(item.thread_ts);
    const userId = string(item.user);
    const userName = string(item.user_name ?? item.user);
    const mentionedUserIds = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/gi)].map((match) => match[1]).filter(Boolean);
    const files = Array.isArray(item.files) ? item.files.map(object) : [];
    const relationships: RelationshipEdge[] = [];
    if (thread && thread !== externalId) relationships.push(
      edge(externalId, thread, "reply_to", "Slack thread reply"),
      edge(externalId, thread, "in_thread", "Slack thread")
    );
    if (userId) relationships.push(edge(externalId, `slack-user:${userId}`, "authored_by", "Slack author"));
    if (channelId) relationships.push(edge(externalId, `slack-channel:${channelId}`, "contained_in", "Slack channel"));
    for (const mentioned of mentionedUserIds) relationships.push(edge(externalId, `slack-user:${mentioned}`, "mentions", "Slack mention"));
    const message: NormalizedRecord = {
      sourceId, externalId, kind: "slack_message", title: channel ? `#${channel} · ${string(item.user_name ?? item.user, "Message")}` : `Slack message ${externalId}`,
      bodyMarkdown: text, sourceUrl: httpUrl(item.permalink),
      authors: [userName].filter(Boolean), createdAt: date(Number(externalId) * 1000), updatedAt: date(item.edited_ts),
      deletedAt: tombstoneDate(item),
      metadata: { channel, threadTs: thread || null, reactions: item.reactions ?? [] },
      attachments: files.map((file) => ({ externalId: string(file.id), name: string(file.name, "attachment"), url: string(file.url_private_download ?? file.url_private) || undefined, mimeType: string(file.mimetype) || undefined, size: Number(file.size) || undefined })), relationships
    };
    const attachments: NormalizedRecord[] = files.filter((file) => string(file.id)).map((file) => ({
      sourceId, externalId: string(file.id), kind: string(file.mimetype, "slack_attachment"), title: string(file.name, "Slack attachment"),
      bodyMarkdown: `# ${string(file.name, "Slack attachment")}\n\nAttached to a Slack message.${file.pretty_type ? `\n\nType: ${string(file.pretty_type)}` : ""}`,
      sourceUrl: httpUrl(file.permalink ?? file.url_private_download ?? file.url_private), authors: message.authors,
      deletedAt: tombstoneDate(file), metadata: { ...file, downloadRequired: true }, attachments: [], relationships: [edge(string(file.id), externalId, "attached_to", "Attached to Slack message")]
    }));
    const entities: NormalizedRecord[] = [];
    if (userId) entities.push({
      sourceId, externalId: `slack-user:${userId}`, kind: "person", title: userName || userId,
      bodyMarkdown: `# ${userName || userId}\n\nSlack person entity.`, authors: [], metadata: { synthetic: true, slackUserId: userId }, attachments: [], relationships: []
    });
    for (const mentioned of mentionedUserIds) if (mentioned !== userId) entities.push({
      sourceId, externalId: `slack-user:${mentioned}`, kind: "person", title: mentioned,
      bodyMarkdown: `# ${mentioned}\n\nMentioned Slack person entity.`, authors: [], metadata: { synthetic: true, slackUserId: mentioned }, attachments: [], relationships: []
    });
    if (channelId) entities.push({
      sourceId, externalId: `slack-channel:${channelId}`, kind: "channel", title: channel ? `#${channel}` : channelId,
      bodyMarkdown: `# ${channel ? `#${channel}` : channelId}\n\nSlack channel entity.`, authors: [], metadata: { synthetic: true, slackChannelId: channelId }, attachments: [], relationships: []
    });
    return [message, ...attachments, ...entities];
  });
  return [...new Map(records.map((record) => [record.externalId, record])).values()];
}

function drive(items: Record<string, unknown>[], sourceId: string): NormalizedRecord[] {
  return items.map((item) => {
    const externalId = string(item.id);
    const parents = strings(item.parents);
    const body = string(item.text ?? item.content ?? item.description ?? item.exported_text);
    return { sourceId, externalId, kind: string(item.mimeType, "drive_file"), title: string(item.name, "Untitled Drive file"),
      bodyMarkdown: body || `# ${string(item.name, "Untitled Drive file")}\n\n${string(item.description, "No extracted text was returned by this listing call.")}`,
      sourceUrl: httpUrl(item.webViewLink ?? item.webContentLink), authors: strings(item.owners), createdAt: date(item.createdTime), updatedAt: date(item.modifiedTime),
      deletedAt: tombstoneDate(item),
      metadata: { ...item, downloadRequired: !body && string(item.mimeType) !== "application/vnd.google-apps.folder" }, attachments: [], relationships: parents.map((parent) => edge(externalId, parent, "contained_in", "Google Drive parent")) };
  }).filter((record) => record.externalId);
}

function notion(items: Record<string, unknown>[], sourceId: string): NormalizedRecord[] {
  return items.map((item) => {
    const externalId = string(item.id);
    const properties = object(item.properties);
    const titleProperty = object(properties.title ?? properties.Name);
    const titleArray = Array.isArray(titleProperty.title) ? titleProperty.title.map((value) => string(object(value).plain_text)).join("") : "";
    const parent = object(item.parent);
    const parentId = string(parent.page_id ?? parent.database_id ?? parent.data_source_id);
    const title = string(item.title, titleArray || "Untitled Notion page");
    return { sourceId, externalId, kind: string(item.object, "notion_page"), title, bodyMarkdown: string(item.markdown ?? item.content, `# ${title}`),
      sourceUrl: httpUrl(item.url), authors: strings(item.authors), createdAt: date(item.created_time), updatedAt: date(item.last_edited_time), deletedAt: tombstoneDate(item), metadata: item,
      attachments: [], relationships: parentId ? [edge(externalId, parentId, "contained_in", "Notion parent")] : [] };
  }).filter((record) => record.externalId);
}

function issueLike(items: Record<string, unknown>[], sourceId: string, toolkit: string): NormalizedRecord[] {
  return items.map((item) => {
    const externalId = string(item.id ?? item.node_id ?? item.key ?? item.identifier);
    const user = object(item.user ?? item.author ?? item.assignee ?? item.creator);
    const comments = Array.isArray(item.comments) ? item.comments.map(object) : [];
    const title = string(item.title ?? item.subject ?? item.summary, `${toolkit} record ${externalId}`);
    const body = string(item.body ?? item.description ?? item.content ?? item.snippet);
    return { sourceId, externalId, kind: `${toolkit}_record`, title,
      bodyMarkdown: `# ${title}\n\n${body}${comments.length ? `\n\n## Comments\n\n${comments.map((comment) => `- **${string(object(comment.user ?? comment.author).login ?? object(comment.user ?? comment.author).name, "Unknown")}**: ${string(comment.body ?? comment.text)}`).join("\n")}` : ""}`,
      sourceUrl: httpUrl(item.html_url ?? item.url ?? item.webUrl ?? item.permalink),
      authors: [string(user.login ?? user.name ?? user.email)].filter(Boolean), createdAt: date(item.created_at ?? item.createdAt), updatedAt: date(item.updated_at ?? item.updatedAt),
      deletedAt: tombstoneDate(item),
      metadata: item, attachments: [], relationships: [] };
  }).filter((record) => record.externalId);
}

function generic(items: Record<string, unknown>[], sourceId: string, toolkit: string): NormalizedRecord[] {
  return items.map((item, index) => {
    const externalId = string(item.id ?? item.uuid ?? item.key ?? item.external_id, `${toolkit}-${index}-${Buffer.from(JSON.stringify(item)).toString("base64url").slice(0, 20)}`);
    const title = string(item.title ?? item.name ?? item.subject ?? item.summary, `${toolkit} record`);
    return { sourceId, externalId, kind: `${toolkit}_record`, title, bodyMarkdown: `# ${title}${markdownJson(item)}`,
      sourceUrl: httpUrl(item.url ?? item.permalink ?? item.web_url), authors: strings(item.authors ?? item.owners),
      createdAt: date(item.created_at ?? item.createdAt), updatedAt: date(item.updated_at ?? item.updatedAt), deletedAt: tombstoneDate(item), metadata: item, attachments: [], relationships: [] };
  });
}

export function normalizeComposioResponse(toolkit: string, sourceId: string, response: ComposioToolResponse) {
  const parsed = composioToolResponseSchema.parse(response);
  if (!parsed.successful) throw new Error(parsed.error || `${toolkit} returned an unsuccessful response`);
  const items = findItems(parsed.data);
  const slug = toolkit.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug === "slack") return slack(items, sourceId);
  if (["googledrive", "onedrive", "sharepoint", "dropbox", "box"].includes(slug)) return drive(items, sourceId);
  if (slug === "notion") return notion(items, sourceId);
  if (["github", "jira", "linear", "confluence", "gmail"].includes(slug)) return issueLike(items, sourceId, slug);
  return generic(items, sourceId, slug || "source");
}
