/**
 * DingTalk event-subscription callback crypto (AES-CBC + PKCS#7)
 *
 * Reference: https://open.dingtalk.com/document/isvapp/callback-event-message-body-encryption-and-decryption
 *
 * Plaintext layout before encryption:
 *   random(16B) + msg_len(4B big-endian) + msg + receiverId
 */

import crypto from 'crypto'

export class DingTalkCallbackCrypto {
  private aesKey: Buffer
  private token: string
  private receiverId: string  // AppKey (event subscription) or CorpId (HTTP registration)

  constructor(token: string, encodingAESKey: string, receiverId: string) {
    this.token = token
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64') // 43-char → 32-byte key (add padding '=')
    this.receiverId = receiverId
  }

  // ── Signature ──

  /** Compute SHA1 digest of sorted (token, timestamp, nonce, encrypt) */
  getSignature(timestamp: string, nonce: string, encrypt: string): string {
    const raw = [this.token, timestamp, nonce, encrypt].sort().join('')
    return crypto.createHash('sha1').update(raw, 'utf-8').digest('hex')
  }

  // ── Decrypt ──

  /** Decrypt a DingTalk-encrypted message. Returns the plaintext. */
  decrypt(encrypt: string): string {
    const ciphertext = Buffer.from(encrypt, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.aesKey.subarray(0, 16))
    decipher.setAutoPadding(false)
    let plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    // Remove PKCS#7 padding
    const padLen = plaintext[plaintext.length - 1]
    plaintext = plaintext.subarray(0, plaintext.length - padLen)

    // Parse: random(16) + msg_len(4) + msg + receiverId
    const msgLen = plaintext.readUInt32BE(16)
    const msg = plaintext.subarray(20, 20 + msgLen).toString('utf-8')
    const rid = plaintext.subarray(20 + msgLen).toString('utf-8')

    if (rid !== this.receiverId) {
      throw new Error(`ReceiverId mismatch: expected "${this.receiverId}", got "${rid}"`)
    }

    return msg
  }

  // ── Encrypt ──

  /** Encrypt a plaintext message for DingTalk callback response. */
  encrypt(plainMsg: string): string {
    const random = crypto.randomBytes(16)
    const msgBuf = Buffer.from(plainMsg, 'utf-8')
    const msgLen = Buffer.alloc(4)
    msgLen.writeUInt32BE(msgBuf.length, 0)
    const ridBuf = Buffer.from(this.receiverId, 'utf-8')

    let raw = Buffer.concat([random, msgLen, msgBuf, ridBuf])

    // PKCS#7 padding
    const blockSize = 16
    const padLen = blockSize - (raw.length % blockSize)
    const pad = Buffer.alloc(padLen, padLen)
    raw = Buffer.concat([raw, pad])

    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.aesKey.subarray(0, 16))
    cipher.setAutoPadding(false)
    return Buffer.concat([cipher.update(raw), cipher.final()]).toString('base64')
  }

  // ── Full response wrapper ──

  /** Build the JSON response body for DingTalk callback (verification or push reply). */
  buildResponse(plainMsg: string, timestamp: string, nonce: string): {
    msg_signature: string
    timeStamp: string
    nonce: string
    encrypt: string
  } {
    const encrypt = this.encrypt(plainMsg)
    const msg_signature = this.getSignature(timestamp, nonce, encrypt)
    return {
      msg_signature,
      timeStamp: timestamp,
      nonce,
      encrypt,
    }
  }
}
