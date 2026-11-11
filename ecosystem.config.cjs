module.exports = {
	apps: [
		{
			name: 'SPORTLIFE UPDATES',
			cwd: __dirname,
			script: './dist/index.js',
			// Версія Node з nvm (має збігатися з .nvmrc і бути встановленою: nvm install)
			interpreter: 'node@24.12.0',
			node_args: '--env-file-if-exists=.env',
			watch: false,
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			log_file: '/home/logs/SPORTLIFE_UPDATES.log',
		},
	],
};
