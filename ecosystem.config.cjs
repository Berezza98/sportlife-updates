module.exports = {
	apps: [
		{
			name: 'SPORTLIFE UPDATES',
			cwd: __dirname,
			script: './dist/index.js',
			node_args: '--env-file-if-exists=.env',
			watch: false,
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			log_file: '/home/logs/SPORTLIFE_UPDATES.log',
		},
	],
};
