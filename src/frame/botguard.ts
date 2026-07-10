import type { IntegrityTokenData, WebPoSignalOutput } from 'bgutils-js'

import { BG, buildURL, GOOG_API_KEY } from 'bgutils-js'

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const ATT_GET_URL = 'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json'

type BotguardContext = {
  client: {
    visitorData: string
    clientVersion: string
  }
}

type MinterSession = {
  client: InstanceType<typeof BG.BotGuardClient>
  minter: InstanceType<typeof BG.WebPoMinter>
  script: HTMLScriptElement
  expiresAt: number
}

let session: MinterSession | undefined
let pending: Promise<MinterSession> | undefined

const fetchChallenge = async (context: BotguardContext) => {
  const response = await fetch(ATT_GET_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-visitor-id': context.client.visitorData,
      'x-youtube-client-name': '1',
      'x-youtube-client-version': context.client.clientVersion,
    },
    body: JSON.stringify({ engagementType: 'ENGAGEMENT_TYPE_UNBOUND', context }),
  })
  if (!response.ok) throw new Error(`botguard: challenge returned ${response.status}`)
  const data = await response.json() as {
    bgChallenge?: {
      program: string
      globalName: string
      interpreterUrl?: {
        privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string
      }
    }
  }
  const challenge = data.bgChallenge
  if (!challenge) throw new Error('botguard: challenge is missing')
  let interpreterUrl = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (!interpreterUrl) throw new Error('botguard: interpreter URL is missing')
  if (interpreterUrl.startsWith('//')) interpreterUrl = `https:${interpreterUrl}`
  const interpreter = await fetch(interpreterUrl).then((result) => result.text())
  return { ...challenge, interpreter }
}

const createSession = async (context: BotguardContext): Promise<MinterSession> => {
  const challenge = await fetchChallenge(context)
  const script = document.createElement('script')
  script.textContent = challenge.interpreter
  document.head.appendChild(script)
  const client = await BG.BotGuardClient.create({
    globalObj: globalThis,
    globalName: challenge.globalName,
    program: challenge.program,
  })
  const webPoSignalOutput: WebPoSignalOutput = []
  const botguardResponse = await client.snapshot({ webPoSignalOutput })
  const integrity = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  }).then((response) => response.json()) as [string | null, number, number | null, string]
  const token = {
    integrityToken: integrity[0] ?? undefined,
    estimatedTtlSecs: integrity[1],
    mintRefreshThreshold: integrity[2] ?? undefined,
    websafeFallbackToken: integrity[3],
  } satisfies IntegrityTokenData
  if (!token.integrityToken && !token.websafeFallbackToken) throw new Error('botguard: integrity token is missing')
  return {
    client,
    minter: await BG.WebPoMinter.create(token, webPoSignalOutput),
    script,
    expiresAt: performance.now() + (token.estimatedTtlSecs ?? 3_600) * 800,
  }
}

const getSession = (context: BotguardContext) => {
  if (session && performance.now() < session.expiresAt) return Promise.resolve(session)
  pending ??= createSession(context).then(
    (next) => {
      session = next
      pending = undefined
      return next
    },
    (error) => {
      pending = undefined
      throw error
    },
  )
  return pending
}

export const mintPoToken = async (identifier: string, context: BotguardContext) =>
  (await getSession(context)).minter.mintAsWebsafeString(identifier)

export const resetPoTokenSession = () => {
  if (!session) return
  session.client.shutdown()
  session.script.remove()
  session = undefined
}
