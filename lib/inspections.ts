// Digital vehicle inspections, per §6.3.
//
// The point of a digital inspection is not the checklist -- shops have had
// clipboards for fifty years. The point is that the customer sees the red item
// with a photo of it, from their phone, while the car is still on the lift.
// So the shape here is: a template becomes a result, a technician marks each
// item green/yellow/red, and sending it mints a share token.
//
// The token is minted at send, not at start, so an unfinished checklist has no
// reachable URL to leak.

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { Condition } from "@/lib/generated/prisma";

export class InspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionError";
  }
}

export type TemplateItem = { section: string; label: string };

export const CONDITION_LABEL: Record<Condition, string> = {
  GREEN: "Good",
  YELLOW: "Worth watching",
  RED: "Needs attention",
  NA: "Not checked",
};

/**
 * A sane starting checklist, so a new shop is not staring at an empty screen.
 * Templates are editable; this is a default, not a rule.
 */
export const DEFAULT_TEMPLATE: TemplateItem[] = [
  { section: "Tires & brakes", label: "Left front tire tread" },
  { section: "Tires & brakes", label: "Right front tire tread" },
  { section: "Tires & brakes", label: "Left rear tire tread" },
  { section: "Tires & brakes", label: "Right rear tire tread" },
  { section: "Tires & brakes", label: "Front brake pads" },
  { section: "Tires & brakes", label: "Rear brake pads" },
  { section: "Tires & brakes", label: "Rotors" },
  { section: "Under the hood", label: "Engine oil level and condition" },
  { section: "Under the hood", label: "Coolant" },
  { section: "Under the hood", label: "Brake fluid" },
  { section: "Under the hood", label: "Transmission fluid" },
  { section: "Under the hood", label: "Air filter" },
  { section: "Under the hood", label: "Cabin filter" },
  { section: "Under the hood", label: "Battery and terminals" },
  { section: "Under the hood", label: "Belts and hoses" },
  { section: "Underneath", label: "Suspension and shocks" },
  { section: "Underneath", label: "Steering components" },
  { section: "Underneath", label: "Exhaust system" },
  { section: "Underneath", label: "Leaks" },
  { section: "Outside", label: "Wiper blades" },
  { section: "Outside", label: "Exterior lights" },
  { section: "Outside", label: "Horn" },
];

function parseTemplate(json: string): TemplateItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InspectionError("That inspection template is not readable.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new InspectionError("That inspection template has no items on it.");
  }
  return parsed.map((raw) => {
    // Tolerates a plain list of strings as well as {section, label} objects, so
    // a template typed by hand does not have to know the schema.
    if (typeof raw === "string") return { section: "Inspection", label: raw };
    const item = raw as { section?: unknown; label?: unknown };
    return {
      section: typeof item.section === "string" && item.section.trim() ? item.section.trim() : "Inspection",
      label: String(item.label ?? "").trim(),
    };
  }).filter((i) => i.label !== "");
}

// -------------------------------------------------------------- templates

export async function listTemplates(tenantId: string) {
  return db.inspectionTemplate.findMany({
    where: { tenantId, active: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createTemplate(
  tenantId: string,
  input: { name: string; serviceType?: string | null; items: TemplateItem[] },
) {
  const name = input.name.trim();
  if (!name) throw new InspectionError("Give the template a name.");
  if (input.items.length === 0) throw new InspectionError("A template needs at least one item.");

  return db.inspectionTemplate.create({
    data: {
      tenantId,
      name,
      serviceType: input.serviceType?.trim() || null,
      itemsJson: JSON.stringify(input.items),
    },
  });
}

/** Gives a shop the default checklist the first time it needs one. */
export async function ensureDefaultTemplate(tenantId: string) {
  const existing = await db.inspectionTemplate.findFirst({ where: { tenantId, active: true } });
  if (existing) return existing;
  return createTemplate(tenantId, { name: "Multi-point inspection", items: DEFAULT_TEMPLATE });
}

// ---------------------------------------------------------------- results

export async function getInspection(tenantId: string, id: string) {
  return db.inspectionResult.findFirst({
    where: { id, tenantId },
    include: {
      template: { select: { name: true } },
      items: { orderBy: { sort: "asc" } },
      repairOrder: {
        select: {
          id: true, number: true, status: true,
          customer: true, vehicle: true, location: true,
        },
      },
    },
  });
}

/** Public lookup. Not tenant-scoped on purpose: the token is the credential,
 *  and it is the only way in from outside. */
export async function getInspectionByToken(token: string) {
  if (!token) return null;
  return db.inspectionResult.findUnique({
    where: { shareToken: token },
    include: {
      items: { orderBy: { sort: "asc" } },
      repairOrder: { select: { number: true, customer: true, vehicle: true, location: true } },
    },
  });
}

/**
 * Starts an inspection on a repair order.
 *
 * Items are copied from the template rather than referenced, so editing the
 * template next month never rewrites an inspection already shown to a customer.
 */
export async function startInspection(
  tenantId: string,
  repairOrderId: string,
  opts: { templateId?: string | null } = {},
) {
  const ro = await db.repairOrder.findFirst({ where: { id: repairOrderId, tenantId } });
  if (!ro) throw new InspectionError("That repair order no longer exists.");

  const template = opts.templateId
    ? await db.inspectionTemplate.findFirst({ where: { id: opts.templateId, tenantId } })
    : await ensureDefaultTemplate(tenantId);
  if (!template) throw new InspectionError("That inspection template no longer exists.");

  const items = parseTemplate(template.itemsJson);

  const result = await db.inspectionResult.create({
    data: { tenantId, repairOrderId, templateId: template.id },
  });

  await db.inspectionItem.createMany({
    data: items.map((item, i) => ({
      resultId: result.id,
      section: item.section,
      label: item.label,
      sort: i,
    })),
  });

  return result;
}

export async function setItem(
  tenantId: string,
  itemId: string,
  input: { condition?: Condition; notes?: string | null },
) {
  const item = await db.inspectionItem.findUnique({ where: { id: itemId }, include: { result: true } });
  if (!item || item.result.tenantId !== tenantId) throw new InspectionError("That inspection item no longer exists.");
  if (item.result.status === "SENT") {
    throw new InspectionError("This inspection has already been sent to the customer and can no longer be changed.");
  }

  return db.inspectionItem.update({
    where: { id: itemId },
    data: {
      condition: input.condition ?? undefined,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
    },
  });
}

export function summarise(items: { condition: Condition }[]) {
  const counts = { GREEN: 0, YELLOW: 0, RED: 0, NA: 0 };
  for (const item of items) counts[item.condition] += 1;
  return { ...counts, checked: items.length - counts.NA, total: items.length };
}

export async function completeInspection(tenantId: string, resultId: string) {
  const result = await db.inspectionResult.findFirst({ where: { id: resultId, tenantId }, include: { items: true } });
  if (!result) throw new InspectionError("That inspection no longer exists.");
  if (result.status === "SENT") return result;

  const { checked } = summarise(result.items);
  if (checked === 0) {
    throw new InspectionError("Mark at least one item before finishing the inspection.");
  }

  return db.inspectionResult.update({
    where: { id: resultId },
    data: { status: "COMPLETE", completedAt: new Date() },
  });
}

/**
 * Sends the inspection to the customer and mints the share token.
 *
 * Like sending an estimate, the message row is written whether or not a
 * provider is wired up, so the shop has a record of what it told the customer
 * and when. Nothing here pretends the message was delivered.
 */
export async function sendInspection(tenantId: string, resultId: string) {
  const result = await db.inspectionResult.findFirst({
    where: { id: resultId, tenantId },
    include: { items: true, repairOrder: { select: { number: true, customerId: true } } },
  });
  if (!result) throw new InspectionError("That inspection no longer exists.");

  const { checked, RED, YELLOW } = summarise(result.items);
  if (checked === 0) throw new InspectionError("Mark at least one item before sending the inspection.");

  const token = result.shareToken ?? randomBytes(24).toString("base64url");
  const saved = await db.inspectionResult.update({
    where: { id: resultId },
    data: {
      status: "SENT",
      shareToken: token,
      sentAt: new Date(),
      completedAt: result.completedAt ?? new Date(),
    },
  });

  const customer = await db.customer.findFirst({ where: { id: result.repairOrder.customerId, tenantId } });
  // §7: opt-outs are checked before every send.
  const channel =
    customer && !customer.smsOptOut && customer.phone ? "SMS"
      : customer && !customer.emailOptOut && customer.email ? "EMAIL"
        : null;

  if (customer && channel) {
    const headline =
      RED > 0 ? `${RED} item${RED === 1 ? " needs" : "s need"} attention`
        : YELLOW > 0 ? `${YELLOW} item${YELLOW === 1 ? " is" : "s are"} worth watching`
          : "everything looks good";
    await db.message.create({
      data: {
        tenantId,
        customerId: customer.id,
        parentType: "REPAIR_ORDER",
        parentId: result.repairOrderId,
        channel,
        template: "inspection_ready",
        toAddress: channel === "SMS" ? customer.phone! : customer.email!,
        body: `Your inspection for RO #${result.repairOrder.number} is ready — ${headline}.`,
        status: "QUEUED",
      },
    });
  }

  return { result: saved, token, channel };
}

/** Groups items the way the customer reads them. */
export function groupItems<T extends { section: string | null; sort: number }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.section ?? "Inspection";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([section, list]) => ({
    section,
    items: list.sort((a, b) => a.sort - b.sort),
  }));
}
