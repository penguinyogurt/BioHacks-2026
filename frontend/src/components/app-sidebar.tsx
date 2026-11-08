import {
  Activity, AlarmClock, Bell, BookOpen, CalendarDays, CirclePlus, ClipboardCheck, FileText, FlaskConical, Hand,
  HardDrive, Keyboard, LayoutDashboard, LogOut, Mic, MoreVertical, NotebookPen, PenLine, Pill, Settings, Shield,
  TrendingUp, UserCircle, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar'

type NavItem = { value: string; label: string; icon: LucideIcon }

/** Callio Labs' sidebar shape: primary action, main nav, labelled groups, secondary links pinned low. */
export const NAV_MAIN: NavItem[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'trends', label: 'Trends', icon: TrendingUp },
  { value: 'forecast', label: 'Progression forecast', icon: Activity },
  { value: 'alerts', label: 'Alerts', icon: Bell },
  { value: 'diary', label: 'Symptom diary', icon: NotebookPen },
]

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Assessments',
    items: [
      { value: 'typing', label: 'Typing', icon: Keyboard },
      { value: 'speech', label: 'Speech tasks', icon: Mic },
      { value: 'handwriting', label: 'Handwriting & spiral', icon: PenLine },
      { value: 'tapping', label: 'Finger tapping', icon: Hand },
      { value: 'self-report', label: 'ALSFRS-R self-report', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { value: 'reports', label: 'Reports & sharing', icon: FileText },
      { value: 'visits', label: 'Clinic visits', icon: CalendarDays },
      { value: 'medications', label: 'Medications', icon: Pill },
      { value: 'trials', label: 'Clinical trials', icon: FlaskConical },
      { value: 'care-team', label: 'Care team', icon: Users },
    ],
  },
]

export const NAV_SECONDARY: NavItem[] = [
  { value: 'devices', label: 'Devices & capture', icon: HardDrive },
  { value: 'privacy', label: 'Data & privacy', icon: Shield },
  { value: 'settings', label: 'Settings', icon: Settings },
]

export const ALL_NAV: NavItem[] = [
  { value: 'assessment', label: 'New assessment', icon: CirclePlus },
  ...NAV_MAIN,
  ...NAV_GROUPS.flatMap((g) => g.items),
  ...NAV_SECONDARY,
]

export type Profile = { name: string; email: string; avatar?: string }

const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'

function NavList({ items, active, select }: { items: NavItem[]; active: string; select: (v: string) => void }) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.value}>
          <SidebarMenuButton tooltip={item.label} isActive={active === item.value} onClick={() => select(item.value)}>
            <item.icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

export function AppSidebar({
  active,
  onSelect,
  profile,
  onSignOut,
}: {
  active: string
  onSelect: (view: string) => void
  profile: Profile
  onSignOut?: () => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const select = (value: string) => {
    onSelect(value)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader className="pt-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-auto !p-2 !pt-3 hover:bg-transparent active:bg-transparent" onClick={() => select('overview')}>
              <span className="font-brand text-3xl leading-none">motus</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New assessment"
                  onClick={() => select('assessment')}
                  className="min-w-8 bg-primary/80 text-primary-foreground duration-200 ease-linear hover:bg-primary hover:text-primary-foreground active:bg-primary active:text-primary-foreground"
                >
                  <CirclePlus />
                  <span>New assessment</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <NavList items={NAV_MAIN} active={active} select={select} />
          </SidebarGroupContent>
        </SidebarGroup>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <NavList items={group.items} active={active} select={select} />
          </SidebarGroup>
        ))}

        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <NavList items={NAV_SECONDARY} active={active} select={select} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <Avatar className="size-8 rounded-lg grayscale">
                    {profile.avatar ? <AvatarImage src={profile.avatar} alt="" referrerPolicy="no-referrer" /> : null}
                    <AvatarFallback className="rounded-lg">{initials(profile.name)}</AvatarFallback>
                  </Avatar>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{profile.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
                  </span>
                  <MoreVertical className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      {profile.avatar ? <AvatarImage src={profile.avatar} alt="" referrerPolicy="no-referrer" /> : null}
                      <AvatarFallback className="rounded-lg">{initials(profile.name)}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{profile.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => select('settings')}>
                    <UserCircle /> Account
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => select('alerts')}>
                    <AlarmClock /> Notifications
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => select('privacy')}>
                    <BookOpen /> Data & privacy
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!onSignOut} onSelect={() => onSignOut?.()}>
                  <LogOut /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
