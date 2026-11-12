// Sign-ups waiting for approval (their name didn't match the class list). Admins handle the whole batch; group
// leaders handle their own group, so approvals don't all land on one person. Polled, and a notification fires
// when someone new is waiting.
import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from './meeting'
import { friendlyError, supabase } from './supabase'

export interface Pending {
  user_id: string
  index_no: string
  full_name: string
  nickname: string | null
  grp: string | null
  subgroup: string | null
  email: string | null
  claimed_at: string | null
}

const POLL_MS = 45_000

export function usePendingMembers(enabled: boolean): {
  list: Pending[]
  error: string | null
  decide: (p: Pending, approve: boolean) => Promise<string | null>
  approveAll: () => Promise<string | null>
} {
  const [list, setList] = useState<Pending[]>([])
  const [error, setError] = useState<string | null>(null)
  const known = useRef<Set<string> | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('pending_members')
    if (e) return setError(friendlyError(e, 'load sign-ups'))
    setError(null)
    const rows = (data ?? []) as Pending[]
    // Tell the approver about new sign-ups (not the ones already waiting when the app opened).
    if (known.current) {
      const fresh = rows.filter((r) => !known.current!.has(r.user_id))
      if (fresh.length) void notify('Waiting to join SPATREN', `${fresh.map((r) => r.nickname || r.full_name).join(', ')} · tap to approve`, 'pending-members')
    }
    known.current = new Set(rows.map((r) => r.user_id))
    setList(rows)
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [enabled, load])

  const decide = useCallback(
    async (p: Pending, approve: boolean) => {
      const { data, error: e } = await supabase.rpc('decide_member', { p_user: p.user_id, p_approve: approve })
      void load()
      if (e) return friendlyError(e, approve ? 'approve them' : 'turn them away')
      return data === 'approved' || data === 'declined' ? null : `Already handled (${String(data).replace('already_', '')}).`
    },
    [load],
  )

  const approveAll = useCallback(async () => {
    const results = await Promise.all(list.map((p) => supabase.rpc('decide_member', { p_user: p.user_id, p_approve: true })))
    void load()
    const failed = results.filter((r) => r.error).length
    return failed ? `${failed} couldn't be approved. Try again.` : null
  }, [list, load])

  return { list, error, decide, approveAll }
}
