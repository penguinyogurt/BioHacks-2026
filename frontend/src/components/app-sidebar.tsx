import { Activity, ChevronRight, CirclePlus, ClipboardList, LogOut, MoreVertical, Settings2, Stethoscope } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar,
} from '@/components/ui/sidebar'

/** Same shape as calhacks' BranchedMenu navigation: groups with child views. */
export const NAVIGATION = [
  {
    label: 'Monitoring',
    icon: Activity,
    children: [
      { value: 'overview', label: 'Overview' },
      { value: 'trends', label: 'Trends' },
      { value: 'forecast', label: 'Progression forecast' },
      { value: 'alerts', label: 'Alerts' },
      { value: 'diary', label: 'Symptom diary' },
    ],
  },
  {
    label: 'Assessments',
    icon: ClipboardList,
    children: [
      { value: 'typing', label: 'Typing' },
      { value: 'speech', label: 'Speech tasks' },
      { value: 'handwriting', label: 'Handwriting & spiral' },
      { value: 'tapping', label: 'Finger tapping' },
      { value: 'self-report', label: 'ALSFRS-R self-report' },
    ],
  },
  {
    label: 'Clinical',
    icon: Stethoscope,
    children: [
      { value: 'reports', label: 'Reports & sharing' },
      { value: 'visits', label: 'Clinic visits' },
      { value: 'medications', label: 'Medications' },
      { value: 'trials', label: 'Clinical trials' },
      { value: 'care-team', label: 'Care team' },
    ],
  },
  {
    label: 'Account',
    icon: Settings2,
    children: [
      { value: 'devices', label: 'Devices & capture' },
      { value: 'privacy', label: 'Data & privacy' },
      { value: 'settings', label: 'Settings' },
    ],
  },
]

export type Profile = { name: string; email: string; avatar?: string }

const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'

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
    <Sidebar variant="floating" collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-4 pt-5">
        <p className="font-heading text-4xl font-semibold tracking-tight">Motus</p>
        <Button
          variant="outline"
          className="h-10 w-full justify-start gap-2 border-foreground/70 bg-transparent"
          aria-current={active === 'assessment' ? 'page' : undefined}
          onClick={() => select('assessment')}
        >
          <CirclePlus aria-hidden /> Start today’s assessment
        </Button>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarMenu>
            {NAVIGATION.map((group, i) => (
              <Collapsible key={group.label} defaultOpen={i === 0} className="group/collapsible" asChild>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="h-9 font-medium">
                      <group.icon aria-hidden />
                      <span>{group.label}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" aria-hidden />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {group.children.map((child) => (
                        <SidebarMenuSubItem key={child.value}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={active === child.value}
                            className="data-[active=true]:text-primary"
                          >
                            <button type="button" className="w-full" onClick={() => select(child.value)}>
                              {child.label}
                            </button>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8">
                    {profile.avatar ? <AvatarImage src={profile.avatar} alt="" referrerPolicy="no-referrer" /> : null}
                    <AvatarFallback className="text-xs">{initials(profile.name)}</AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{profile.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
                  </span>
                  <MoreVertical className="ml-auto size-4 text-muted-foreground" aria-hidden />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" sideOffset={12} className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate font-medium">{profile.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{profile.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!onSignOut} onSelect={() => onSignOut?.()}>
                  <LogOut aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
