from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in weekly_bank_report/__init__.py
from weekly_bank_report import __version__ as version

setup(
	name="weekly_bank_report",
	version=version,
	description="Weekly Bank Report",
	author="tyler.ritchot@sgatechsolutions.com",
	author_email="tyler.ritchot@sgatechsolutions.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
