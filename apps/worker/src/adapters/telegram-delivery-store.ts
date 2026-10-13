import { z } from 'zod';
import type { TelegramMutationContext } from '../domain/repositories.js';
import { logStructured } from '../domain/env.js';
import { clearGuard, writeGuard, type DatabaseBinding, type Statement } from './d1-database.js';
import { TelegramBotClient } from './telegram-bot-client.js';

const keyboardSchema=z.array(z.array(z.object({text:z.string().max(100),callback_data:z.string().max(64).optional()}))).max(10);
export const telegramDeliveryPayloadSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('edit'),text:z.string().min(1).max(4096)}),
  z.object({kind:z.literal('send'),text:z.string().min(1).max(4096),inline_keyboard:keyboardSchema.optional()}),
]);
const contextSchema=z.object({updateId:z.number().int().nonnegative(),chatId:z.string().regex(/^-?\d+$/),
  messageId:z.number().int().positive().optional(),confirmationText:z.string().max(4096).optional()});

export function telegramMutationStatements(db:DatabaseBinding,eventId:string,context:TelegramMutationContext,
  payload:unknown,result:unknown,now:string):Statement[] {
  const ctx=contextSchema.parse(context);const value=telegramDeliveryPayloadSchema.parse(payload);
  return [db.prepare('INSERT INTO telegram_updates VALUES (?,?,?,?)').bind(ctx.updateId,eventId,now,JSON.stringify(result)),
    db.prepare(`INSERT INTO telegram_deliveries(delivery_id,update_id,chat_id,message_id,revision,payload_json,next_attempt_at)
      VALUES (?,?,?,?,?,?,?)`).bind(`tg_${ctx.updateId}`,ctx.updateId,ctx.chatId,ctx.messageId??0,ctx.updateId,JSON.stringify(value),now)];
}

/** Persist acceptance before HTTP 200; ambiguous sends are never retried automatically. */
export async function acceptTelegramCommand(db:DatabaseBinding,userId:string,updateId:number,chatId:string,payload:unknown,now:string):Promise<void> {
  const existing=await db.prepare('SELECT update_id FROM telegram_updates WHERE update_id=?').bind(updateId).first();
  if(existing) return;
  const guard=crypto.randomUUID();
  try {await db.batch([writeGuard(db,guard),...telegramMutationStatements(db,`tgcmd_${updateId}`,
    {updateId,chatId},payload,{accepted:true,user_id:userId},now),clearGuard(db,guard)]);}
  catch(error) { if(await db.prepare('SELECT update_id FROM telegram_updates WHERE update_id=?').bind(updateId).first()) return;throw error; }
}

export function formatReviewResult(rating:string,nextDueAt:string):string {
  return `Đã ghi nhận (${rating})! Lần ôn kế tiếp: ${new Intl.DateTimeFormat('vi-VN',{
    timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short',
  }).format(new Date(nextDueAt))}.`;
}

const jobSchema=z.object({delivery_id:z.string(),update_id:z.number(),chat_id:z.string(),message_id:z.number(),
  revision:z.number(),payload_json:z.string(),status:z.enum(['pending','leased']),attempts:z.number(),lease_until:z.string()});
export async function processTelegramDeliveries(db:DatabaseBinding,bot:TelegramBotClient,now:string,limit=10):Promise<number> {
  const rows=await db.prepare(`SELECT * FROM telegram_deliveries WHERE (status='pending' AND next_attempt_at<=?)
    OR (status='leased' AND lease_until<=?) ORDER BY revision LIMIT ?`).bind(now,now,limit).all();
  let delivered=0;
  for(const raw of rows.results) {
    const job=jobSchema.parse(raw);
    const payload=telegramDeliveryPayloadSchema.parse(JSON.parse(job.payload_json) as unknown);
    if(payload.kind==='send' && job.status==='leased') {
      await db.prepare("UPDATE telegram_deliveries SET status='dead',last_error='unknown_outcome' WHERE delivery_id=? AND status='leased' AND lease_until<=?")
        .bind(job.delivery_id,now).run();continue;
    }
    if(payload.kind==='edit') {
      const newer=await db.prepare(`SELECT delivery_id FROM telegram_deliveries WHERE chat_id=? AND message_id=?
        AND revision>? LIMIT 1`).bind(job.chat_id,job.message_id,job.revision).first();
      if(newer) {await db.prepare("UPDATE telegram_deliveries SET status='delivered',last_error='superseded' WHERE delivery_id=?")
        .bind(job.delivery_id).run();continue;}
    }
    const token=crypto.randomUUID();const until=new Date(Date.parse(now)+30_000).toISOString();
    const claim=await db.prepare(`UPDATE telegram_deliveries SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1
      WHERE delivery_id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))`)
      .bind(token,until,job.delivery_id,now,now).run();
    if(!claim.meta.changes) continue;
    let ok=false;let unknown=false;let messageId=job.message_id;
    if(payload.kind==='edit') {
      ok=await bot.editReviewResult(Number(job.chat_id),job.message_id,payload.text).catch(()=>false);
    } else {
      const result=await bot.sendMessage({chatId:job.chat_id,text:payload.text,
        ...(payload.inline_keyboard?{inlineKeyboard:payload.inline_keyboard}:{})});
      ok=result.ok;unknown=result.outcome==='unknown';messageId=result.messageId??messageId;
    }
    const dead=unknown || job.attempts+1>=3;
    const next=new Date(Date.parse(now)+30_000*2**job.attempts).toISOString();
    await db.prepare(`UPDATE telegram_deliveries SET status=?,message_id=?,next_attempt_at=?,lease_token='',lease_until='',last_error=?
      WHERE delivery_id=? AND lease_token=?`).bind(ok?'delivered':dead?'dead':'pending',messageId,next,
        ok?'':unknown?'unknown_outcome':'delivery_failed',job.delivery_id,token).run();
    if(ok) delivered++;
    logStructured(ok?'info':'warn','telegram_delivery_result',`tg_${job.update_id}`,{delivered:ok,unknown,attempt:job.attempts+1});
  }
  return delivered;
}
