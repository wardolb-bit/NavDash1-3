WARDLAB NETWORK COMPANION 1.0

Windows: install Python 3.9+ from python.org, extract this entire ZIP into a folder,
then double-click start-network.bat. Keep the terminal window open while using it.
Mac/Linux: extract the ZIP and run python3 wardlab-agent.py from that folder.

The companion opens a browser automatically and listens only on 127.0.0.1, using a
random local port. A new per-session token protects inspection requests. It does
not open your network to the internet. Close the terminal or Ctrl+C to stop.

Enter a private IPv4 network, for example 192.168.1.0/24, or a single host. The
suggested /24 is only a starting guess; confirm it matches your actual network.
Select up to 16 ports. At most 32 TCP connections run concurrently with a 0.4s
connection timeout. Scan only networks you administer. No scan runs automatically.

This is TCP service discovery, not ping or ARP discovery. It lists addresses with
at least one selected open port. Firewalled, sleeping, slow, or silent devices
may not appear. Service labels are common port names, not identified software.

Subnet calculations run locally. Local scan results stay in this process and the
browser unless you export them. Public-domain checks are sent to
https://www.wardlab.dev/api/network and need internet access.

No third-party Python packages are required. Do not run this as administrator.
