export interface Credentials {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export type InstanceState =
  | 'authorized'
  | 'notAuthorized'
  | 'starting'
  | 'pendingPassword'
  | 'blocked'
  | 'suspended'

export type AccountCheck = { exist: true; chatId: string } | { exist: false }

export interface NotificationReceipt {
  receiptId: number
  body: unknown
}
