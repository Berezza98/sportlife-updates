module.exports = {
	apps: [
		{
			name: 'SPORTLIFE UPDATES',
			script: './dist/index.js',
			watch: false,
			instances: 1,
			exec_mode: 'fork',
			autorestart: false,
			log_file: '/home/logs/SPORTLIFE_UPDATES.log',
		},
	],
};
