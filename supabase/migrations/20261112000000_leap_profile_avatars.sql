create table public.leap_profile_avatars (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  choice text not null check (choice ~ '^(initials|photo|portrait-([1-9]|1[0-9]|20))$'),
  photo text,
  check ((choice = 'photo') = (photo is not null)),
  check (photo is null or octet_length(photo) between 1 and 350000)
);

alter table public.leap_profile_avatars enable row level security;
revoke all on public.leap_profile_avatars from public, anon, authenticated;
grant select, insert, update, delete on public.leap_profile_avatars to service_role;
