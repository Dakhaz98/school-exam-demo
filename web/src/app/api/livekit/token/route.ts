import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getApiAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  const auth = await getApiAuth();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'LiveKit is not configured (LIVEKIT_API_KEY / LIVEKIT_API_SECRET)' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { roomName?: string; identity?: string } | null;
  const roomName = body?.roomName?.trim();
  if (!roomName) {
    return NextResponse.json({ error: 'roomName is required' }, { status: 400 });
  }

  const identity = body?.identity?.trim() || auth.userId;
  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  return NextResponse.json({ token, identity });
}
