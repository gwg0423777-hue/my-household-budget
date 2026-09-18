# PC · 모바일 계정 동기화 — 연결 완료 버전

이 ZIP은 현재 `household-budget` Supabase 프로젝트와 이미 연결되어 있습니다.
따라서 Project URL / Publishable Key를 직접 찾아서 복사할 필요가 없습니다.

또한 동기화 테이블과 RLS 보안 정책도 연결된 Supabase 프로젝트에 이미 적용했습니다.

## GitHub Pages에 올린 뒤 할 일
1. ZIP 압축을 풉니다.
2. GitHub 저장소 최상위(root)의 기존 파일을 새 파일로 교체합니다.
3. GitHub Pages 사이트를 새로고침합니다.
4. 가계부의 `설정 / 백업` 탭으로 이동합니다.
5. `PC · 모바일 계정 동기화`에서 본인 이메일과 사용할 비밀번호로 `계정 만들기`를 누릅니다.
6. 확인 메일이 오면 이메일 인증 후 로그인합니다.
7. 기존 PC 가계부 데이터가 있다면 처음 한 번 `이 기기 데이터를 클라우드로 올리기`를 누릅니다.
8. `자동 실시간 동기화`를 켭니다.
9. 모바일에서도 같은 사이트 주소에 접속하고 같은 이메일/비밀번호로 로그인합니다.

## 동기화되는 데이터
- 거래내역
- 채무와 상환 상태
- 자동화 일정
- 입력 대기 항목
- 자산

## 기기별로 유지되는 항목
- 브라우저 잠금 비밀번호
- 자동 잠금 설정

## 중요
- `cloud-config.js`의 Publishable key는 웹앱용 공개 키입니다.
- Supabase의 service_role/secret key는 앱 파일에 절대 넣으면 안 됩니다.
- PC와 모바일에서 같은 항목을 완전히 동시에 수정하면 마지막 저장 내용이 우선될 수 있습니다.


## 비밀번호 재설정
가계부의 `비밀번호를 잊으셨나요?` 버튼은 Supabase Auth 재설정 이메일을 사용합니다.
Supabase Dashboard의 Authentication > URL Configuration에서 아래 주소를 Site URL 및 Redirect URL에 등록하세요.

https://gwg0423777-hue.github.io/my-household-budget/
