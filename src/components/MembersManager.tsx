import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Crown, RefreshCw, Search, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import type { Member } from '../types'
import { supabase } from '../lib/supabase'

type RoleFilter = 'all' | 'user' | 'admin' | 'owner'

function memberRole(member: Member): Exclude<RoleFilter, 'all'> {
  return member.is_owner ? 'owner' : member.is_admin ? 'admin' : 'user'
}

function memberName(member: Member) {
  const name = `${member.first_name} ${member.last_name}`.trim()
  return name || member.email || 'Unnamed member'
}

export default function MembersManager({ isOwner }: { isOwner: boolean }) {
  const [members, setMembers] = useState<Member[]>([])
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  async function loadMembers(isRefresh = false) {
    if (!supabase) {
      setError('The workspace is not connected. Contact your administrator.')
      setLoading(false)
      return
    }
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const result = await supabase.rpc('list_members')
      if (result.error) throw result.error
      setMembers((result.data ?? []) as Member[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load members. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function changeAdmin(member: Member, makeAdmin: boolean) {
    if (!supabase || !isOwner || member.is_owner || updatingUserId) return
    if (!makeAdmin && !window.confirm(`Remove administrator access from ${memberName(member)}?`)) return
    setUpdatingUserId(member.user_id)
    setError('')
    setNotice('')
    try {
      const result = await supabase.rpc('set_member_admin', { p_user_id: member.user_id, p_is_admin: makeAdmin })
      if (result.error) throw result.error
      setNotice(makeAdmin ? `${memberName(member)} is now an administrator.` : `${memberName(member)} is now a user.`)
      await loadMembers(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this member’s role. Please try again.')
    } finally {
      setUpdatingUserId(null)
    }
  }

  useEffect(() => { void loadMembers() }, [])

  const counts = useMemo(() => ({
    all: members.length,
    user: members.filter(member => memberRole(member) === 'user').length,
    admin: members.filter(member => memberRole(member) === 'admin').length,
    owner: members.filter(member => memberRole(member) === 'owner').length,
  }), [members])

  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return members.filter(member => {
      const matchesRole = roleFilter === 'all' || memberRole(member) === roleFilter
      const searchable = `${memberName(member)} ${member.email ?? ''}`.toLowerCase()
      return matchesRole && (!normalized || searchable.includes(normalized))
    })
  }, [members, query, roleFilter])

  return <section className="members-page">
    <div className="page-heading">
      <div><span className="eyebrow">YOUR WORKSPACE</span><h1>Members</h1><p>See who has access to your material intelligence workspace.</p></div>
      <button type="button" className="button button-secondary" disabled={loading || refreshing} onClick={() => void loadMembers(true)}><RefreshCw size={16} className={refreshing ? 'spin' : undefined} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    {error && <div className="notice notice-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
    {notice && <div className="notice notice-success" role="status"><ShieldCheck size={18} /><span>{notice}</span></div>}

    <section className="panel members-panel">
      <div className="members-toolbar">
        <div className="role-tabs" role="group" aria-label="Filter members by role">
          {([['all', 'All members'], ['user', 'Users'], ['admin', 'Admins'], ['owner', 'Owners']] as const).map(([value, label]) => <button key={value} type="button" className={roleFilter === value ? 'active' : ''} aria-pressed={roleFilter === value} onClick={() => setRoleFilter(value)}>{label}<span>{counts[value]}</span></button>)}
        </div>
        <label className="member-search"><Search size={15} /><span className="visually-hidden">Search members</span><input type="search" placeholder="Search name or email…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </div>

      {loading ? <div className="members-empty" role="status"><RefreshCw size={22} className="spin" /><p>Loading members…</p></div> : visibleMembers.length === 0 ? <div className="members-empty"><UsersRound size={25} /><strong>{members.length ? 'No members match this filter' : 'No members yet'}</strong><p>{members.length ? 'Try another role or search term.' : 'Registered accounts will appear here.'}</p></div> : <div className="members-table-wrap"><table className="members-table"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{visibleMembers.map(member => <tr key={member.user_id}>
        <td data-label="Member"><span className="member-identity"><span className="member-avatar">{memberName(member).charAt(0).toUpperCase()}</span><span><strong>{memberName(member)}</strong><small>{member.email ?? 'No email address'}</small></span></span></td>
        <td data-label="Role"><span className={`member-role member-role-${memberRole(member)}`}>{memberRole(member) === 'owner' ? <Crown size={14} /> : member.is_admin ? <ShieldCheck size={14} /> : <UserRound size={14} />}{memberRole(member) === 'owner' ? 'Owner' : member.is_admin ? 'Admin' : 'User'}</span></td>
        <td data-label="Joined">{new Date(member.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td data-label="Actions" className="members-action">{isOwner && !member.is_owner && <button type="button" className={`button button-small ${member.is_admin ? 'button-danger' : 'button-secondary'}`} disabled={updatingUserId !== null} onClick={() => void changeAdmin(member, !member.is_admin)}>{updatingUserId === member.user_id ? 'Saving…' : member.is_admin ? 'Remove admin' : 'Make admin'}</button>}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </section>
}
